// Locke on Base keeper. Long-lived: run it on Railway as its own service, next to the Strike worker.
//
// Every 15 seconds, for each vault not closed:
// - reads the vault on Base (idle USDC, plan limits, pause, keeper, cooldown) and its hedge on
//   Avantis (position, signed price, market hours);
// - decides with src/lib/base/keeper.ts: open the hedge once the deposit is in, add margin when it
//   runs thin, mark the vault closed when the owner closed the hedge;
// - sends the transaction from the keeper key, with Locke's Builder Code appended, and records
//   what happened for the vault page;
// - issues a "Protected by Locke" attestation on EAS once the hedge is open, and revokes it once
//   the vault closes (src/lib/base/attest.ts);
// - for owners who turned on "Protect as you get paid", counts USDC arriving in their Base Account
//   and moves their chosen share into the vault under their spend permission (src/lib/base/income.ts).
// The keeper key can only trade within each vault's on-chain limits; it can never withdraw.
// /healthz answers 503 when Base or the database can't be read, or the keeper is out of gas money.
// A Postgres advisory lock keeps an overlapping deploy on standby.

import http from "node:http";
import { createWalletClient, formatEther, getAddress, http as httpTransport, parseAbiItem, parseEther, parseEventLogs, zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { EAS_ADDRESS, easAbi, PROTECTION_SCHEMA, PROTECTION_SCHEMA_UID, protectionRequest, SCHEMA_REGISTRY_ADDRESS, schemaRegistryAbi } from "../src/lib/base/attest";
import { builderSuffix } from "../src/lib/base/builderCode";
import { baseMarket, erc20Abi, fromUsdcUnits, LAZER_FEE_WEI, P10, PRICE_SOURCING_LAZER, USDC, usdcUnits, vaultAbi } from "../src/lib/base/contracts";
import { collectIncomeAbi, incomeUsd, nextCollectionUsd, onChain, SPEND_PERMISSION_MANAGER, spendPermissionManagerAbi, type SpendPermission } from "../src/lib/base/income";
import { decide, type VaultState, type VaultStatus } from "../src/lib/base/keeper";
import type { BaseSizing } from "../src/lib/domain/basePlans";
import type { RiskLevel } from "../src/lib/domain/types";
import { basePublicClient } from "../src/lib/server/baseChain";
import { activeAttestation, addVaultEvent } from "../src/lib/server/baseVaults";
import { config } from "../src/lib/server/config";
import { db } from "../src/lib/server/db";
import { getMarket, getPositions, getSignedPrice } from "../src/lib/veranta/client";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[base-keeper]", ...a);

const LOOP_MS = 15_000;
const LOCK = 7_310_001; // advisory lock id: one active Base keeper
/** Slippage allowed on an open: 1% (Veranta's 1e10 = 1%). */
const SLIPPAGE = P10;
/** Below this the keeper can't pay for its transactions; health goes red well before it runs out. */
const MIN_GAS_ETH = parseEther("0.0005");
/** Blocks of USDC transfers read per call when counting income (public RPCs cap log ranges). */
const SCAN_BLOCKS = 1000n;
const USDC_TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
/** Repeat a "needs attention" event at most this often per vault. */
const NOTICE_EVERY_MS = 30 * 60_000;

const account = privateKeyToAccount(config.baseKeeperKey);
const client = basePublicClient();
const wallet = createWalletClient({ account, chain: base, transport: httpTransport(config.baseRpcUrl), dataSuffix: builderSuffix(config.baseBuilderCode) });
const lastNotice = new Map<string, { note: string; at: number }>();
let healthy = false;
let lastLoopOk = 0;
let gasLow = false;
let schemaReady = false;

interface Row {
  address: string;
  pair_index: number;
  status: VaultStatus;
  sizing: BaseSizing;
  risk_level: RiskLevel;
  status_note: string | null;
  open_sent_at: Date | null;
  opened_at: Date | null;
}

async function snapshot(row: Row): Promise<VaultState> {
  const vault = getAddress(row.address);
  const pair = BigInt(row.pair_index);
  const read = <T>(functionName: string, args: unknown[] = []) =>
    client.readContract({ address: vault, abi: vaultAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
  const [idle, plan, paused, keeper, lastOpen, block, positions, price, market] = await Promise.all([
    client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [vault] }),
    read<readonly [boolean, boolean, bigint, bigint]>("plans", [pair]),
    read<boolean>("paused"),
    read<Address>("keeper"),
    read<bigint>("lastOpenAt", [pair]),
    client.getBlock(),
    getPositions(row.address),
    getSignedPrice(row.pair_index),
    getMarket(row.pair_index),
  ]);
  const cooldownEnds = Number(lastOpen) + 3600;
  return {
    status: row.status,
    sizing: row.sizing,
    prevLevel: row.risk_level,
    idleUsd: fromUsdcUnits(idle),
    maxNotionalUsd: fromUsdcUnits(plan[3]),
    position: positions.find((p) => p.pairIndex === row.pair_index) ?? null,
    mark: price?.price ?? null,
    marketOpen: market.marketOpen && !market.closeOnly && !!price,
    paused,
    keeperIsUs: keeper.toLowerCase() === account.address.toLowerCase(),
    cooldownLeftS: Math.max(0, cooldownEnds - Number(block.timestamp)),
    openSentAgoS: row.open_sent_at ? (Date.now() - row.open_sent_at.getTime()) / 1000 : null,
  };
}

async function send(vault: Address, functionName: "hedgeOpen" | "topUpMargin", args: readonly unknown[], value = 0n): Promise<Hex> {
  // Simulate first: a revert costs nothing and says why.
  const { request } = await client.simulateContract({ account, address: vault, abi: vaultAbi, functionName, args: args as never, value });
  const hash = await wallet.writeContract(request as never);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted in ${hash}`);
  return hash;
}

/** Record a note on the vault and, at most every half hour per note, an event the owner sees. */
async function note(vault: string, text: string | null, level = "info") {
  await db()`update base_vaults set status_note = ${text}, updated_at = now() where address = ${vault}`;
  if (!text) return lastNotice.delete(vault);
  const prev = lastNotice.get(vault);
  if (prev && prev.note === text && Date.now() - prev.at < NOTICE_EVERY_MS) return;
  lastNotice.set(vault, { note: text, at: Date.now() });
  if (level !== "info") await addVaultEvent(vault, level, text);
}

async function tend(row: Row) {
  const state = await snapshot(row);
  const d = decide(state);
  const vault = getAddress(row.address);
  const sql = db();

  if (d.status !== row.status || d.level !== row.risk_level || d.ratio != null) {
    await sql`
      update base_vaults set status = ${d.status}, risk_level = ${d.level}, last_ratio = ${d.ratio},
        opened_at = case when ${d.status} = 'active' and opened_at is null then now() else opened_at end,
        closed_at = case when ${d.status} = 'closed' and closed_at is null then now() else closed_at end,
        open_sent_at = case when ${state.position != null} then null else open_sent_at end,
        updated_at = now()
      where address = ${row.address}`;
  }
  if (row.status !== "active" && d.status === "active") await addVaultEvent(row.address, "info", "Hedge open on Avantis: the vault is protected");
  // The public proof follows the hedge. A failure here never holds up the hedge; the next round retries.
  if (d.status === "active") await attest(row).catch((e) => log("attest", row.address, "failed:", (e as Error).message));
  if (d.level !== row.risk_level && d.level !== "ok") await addVaultEvent(row.address, "action", `Margin ${Math.round((d.ratio ?? 0) * 100)}% used`, { level: d.level });

  const a = d.action;
  switch (a.kind) {
    case "wait":
      return note(row.address, a.note);
    case "closed":
      await addVaultEvent(row.address, "info", a.note);
      return note(row.address, null);
    case "needFunds":
      return note(row.address, `Margin is getting thin. Deposit about $${a.amountUsd.toFixed(2)} so Locke can add it to the hedge.`, "action");
    case "open": {
      const price = await getSignedPrice(row.pair_index);
      if (!price) return note(row.address, "No price from Avantis right now; opening shortly.");
      const lev = BigInt(Math.round(a.leverage * 1e10));
      await sql`update base_vaults set open_sent_at = now(), status = 'opening', updated_at = now() where address = ${row.address}`;
      const hash = await send(vault, "hedgeOpen", [BigInt(row.pair_index), usdcUnits(a.collateralUsd), lev, BigInt(Math.round(price.price * 1e10)), SLIPPAGE]);
      log("opened", row.address, a, hash);
      await addVaultEvent(row.address, "info", `Hedge sent to Avantis: ${row.sizing.buy ? "long" : "short"} $${row.sizing.notionalUsd.toFixed(2)} at ${a.leverage}x`, undefined, hash);
      return note(row.address, "Waiting for Avantis to fill the hedge.");
    }
    case "topUp": {
      const price = await getSignedPrice(row.pair_index);
      if (!price) return note(row.address, "No price from Avantis right now; adding margin shortly.");
      const hash = await send(vault, "topUpMargin", [BigInt(row.pair_index), BigInt(a.index), usdcUnits(a.amountUsd), [price.updateData], PRICE_SOURCING_LAZER], LAZER_FEE_WEI);
      log("topped up", row.address, a, hash);
      await addVaultEvent(row.address, "action", `Added $${a.amountUsd.toFixed(2)} of margin from the vault's buffer`, undefined, hash);
      return note(row.address, null);
    }
  }
}

/** Issue the vault's "Protected by Locke" attestation to its owner, unless it already has one. */
async function attest(row: Row) {
  if (await activeAttestation(row.address)) return;
  if (!schemaReady) await ensureSchema();
  const vault = getAddress(row.address);
  const owner = (await client.readContract({ address: vault, abi: vaultAbi, functionName: "owner" })) as Address;
  const request = protectionRequest(owner, {
    vault,
    market: baseMarket(row.pair_index)?.symbol ?? String(row.pair_index),
    long: row.sizing.buy,
    protectedUsd: row.sizing.notionalUsd,
    startedAt: Math.floor((row.opened_at ?? new Date()).getTime() / 1000),
  });
  const { request: tx } = await client.simulateContract({ account, address: EAS_ADDRESS, abi: easAbi, functionName: "attest", args: [request] });
  const hash = await wallet.writeContract(tx);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  const [ev] = parseEventLogs({ abi: easAbi, logs: receipt.logs, eventName: "Attested" });
  if (receipt.status !== "success" || !ev) throw new Error(`attest failed in ${hash}`);
  log("attested", row.address, ev.args.uid, hash);
  await addVaultEvent(row.address, "info", "Protected by Locke: proof published on Base", { attestation: ev.args.uid }, hash);
}

/** Revoke the attestation of every vault that has closed, so the proof never outlives the hedge. */
async function revokeClosed() {
  const rows = await db()`
    select v.address from base_vaults v where v.status = 'closed'
      and exists (select 1 from base_vault_events e where e.vault = v.address and e.detail ? 'attestation')`;
  for (const { address } of rows) {
    const uid = await activeAttestation(address);
    if (!uid) continue;
    try {
      const args = [{ schema: PROTECTION_SCHEMA_UID, data: { uid: uid as Hex, value: 0n } }] as const;
      const { request } = await client.simulateContract({ account, address: EAS_ADDRESS, abi: easAbi, functionName: "revoke", args });
      const hash = await wallet.writeContract(request);
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (receipt.status !== "success") throw new Error(`revoke reverted in ${hash}`);
      log("revoked", address, uid, hash);
      await addVaultEvent(address, "info", "Vault closed: the Protected by Locke proof is revoked", { revoked: uid }, hash);
    } catch (e) {
      log("revoke", address, "failed:", (e as Error).message);
    }
  }
}

interface IncomeRow {
  vault: string;
  vault_status: string;
  permission: SpendPermission;
  signature: Hex;
  share_pct: number;
  pending_usd: string;
  last_block: string;
}

/** "Protect as you get paid", for every vault that has it on. */
async function collectIncome() {
  let rows: IncomeRow[];
  try {
    rows = (await db()`
      select i.vault, v.status as vault_status, i.permission, i.signature, i.share_pct, i.pending_usd, i.last_block
      from base_income i join base_vaults v on v.address = i.vault where i.status = 'on'`) as unknown as IncomeRow[];
  } catch (e) {
    if ((e as { code?: string }).code === "42P01") return; // not migrated yet
    throw e;
  }
  if (rows.length === 0) return;
  const latest = await client.getBlockNumber();
  for (const r of rows) {
    try {
      await tendIncome(r, latest);
    } catch (e) {
      log("income", r.vault, "failed:", (e as Error).message);
    }
  }
}

async function tendIncome(r: IncomeRow, latest: bigint) {
  const sql = db();
  const off = async (why: string) => {
    await sql`update base_income set status = 'off', updated_at = now() where vault = ${r.vault}`;
    await addVaultEvent(r.vault, "info", why);
  };
  if (r.vault_status === "closed") return off("Vault closed: Protect as you get paid is off");
  const vault = getAddress(r.vault);
  const p = onChain(r.permission);
  const manager = <T>(functionName: "isRevoked" | "isApproved" | "getCurrentPeriod") =>
    client.readContract({ address: SPEND_PERMISSION_MANAGER, abi: spendPermissionManagerAbi, functionName, args: [p] }) as Promise<T>;
  if (await manager<boolean>("isRevoked")) return off("You revoked the permission in your wallet: Protect as you get paid is off");

  // Count the owner's new income, a block range at a time.
  let pending = Number(r.pending_usd);
  const from = BigInt(r.last_block) + 1n;
  if (from <= latest) {
    const to = latest < from + SCAN_BLOCKS - 1n ? latest : from + SCAN_BLOCKS - 1n;
    const logs = await client.getLogs({ address: USDC, event: USDC_TRANSFER, args: { to: p.account }, fromBlock: from, toBlock: to });
    const income = incomeUsd(logs.map((l) => ({ from: l.args.from!, valueUsd: Number(l.args.value!) / 1e6 })), p.account, vault);
    const add = (income * r.share_pct) / 100;
    await sql`update base_income set last_block = ${to.toString()}, pending_usd = pending_usd + ${add}, updated_at = now() where vault = ${r.vault}`;
    pending += add;
  }

  // Move what's owed, within this week's allowance.
  const period = await manager<{ spend: bigint }>("getCurrentPeriod");
  const amount = nextCollectionUsd(pending, Number(p.allowance - period.spend) / 1e6);
  if (amount == null) return;
  const keeper = (await client.readContract({ address: vault, abi: vaultAbi, functionName: "keeper" })) as Address;
  if (keeper.toLowerCase() !== account.address.toLowerCase()) return; // the owner removed Locke's keeper
  const approved = await manager<boolean>("isApproved");
  const { request } = await client.simulateContract({
    account,
    address: vault,
    abi: collectIncomeAbi,
    functionName: "collectIncome",
    args: [p, approved ? "0x" : r.signature, usdcUnits(amount)],
  });
  const hash = await wallet.writeContract(request);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== "success") throw new Error(`collectIncome reverted in ${hash}`);
  await sql`
    update base_income set pending_usd = greatest(pending_usd - ${amount}, 0), collected_usd = collected_usd + ${amount},
      last_collected_at = now(), updated_at = now()
    where vault = ${r.vault}`;
  log("collected income", r.vault, amount, hash);
  await addVaultEvent(r.vault, "info", `Moved $${amount.toFixed(2)} of incoming USDC into the vault`, undefined, hash);
}

/** EAS assigns the schema its id from its text; register it the first time any keeper runs. */
async function ensureSchema() {
  const known = await client.readContract({ address: SCHEMA_REGISTRY_ADDRESS, abi: schemaRegistryAbi, functionName: "getSchema", args: [PROTECTION_SCHEMA_UID] });
  if (known.uid === PROTECTION_SCHEMA_UID) {
    schemaReady = true;
    return;
  }
  const { request } = await client.simulateContract({ account, address: SCHEMA_REGISTRY_ADDRESS, abi: schemaRegistryAbi, functionName: "register", args: [PROTECTION_SCHEMA, zeroAddress, true] });
  const hash = await wallet.writeContract(request);
  await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  schemaReady = true;
  log("registered the Protected by Locke schema", PROTECTION_SCHEMA_UID, hash);
}

async function loop() {
  const rows = (await db()`
    select address, pair_index, status, sizing, risk_level, status_note, open_sent_at, opened_at
    from base_vaults where status <> 'closed' order by created_at`) as unknown as Row[];
  for (const row of rows) {
    try {
      await tend(row);
    } catch (e) {
      log("vault", row.address, "failed:", (e as Error).message);
    }
  }
  await revokeClosed();
  await collectIncome();
  const gas = await client.getBalance({ address: account.address });
  gasLow = gas < MIN_GAS_ETH;
  if (gasLow) log(`keeper ${account.address} is low on ETH: ${formatEther(gas)}`);
  lastLoopOk = Date.now();
}

async function main() {
  if (!config.baseFactoryAddress) throw new Error("BASE_FACTORY_ADDRESS is not set");
  const sql = db();
  const port = Number(process.env.PORT ?? 8080);
  http
    .createServer((req, res) => {
      if (req.url !== "/healthz") return res.writeHead(404).end();
      const ok = healthy && !gasLow && Date.now() - lastLoopOk < 4 * LOOP_MS;
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" }).end(JSON.stringify({ ok, keeper: account.address, gasLow, lastLoopOk }));
    })
    .listen(port, () => log(`health on :${port}/healthz, keeper ${account.address}`));

  // One active keeper: wait for the lock (a deploy overlapping the old one waits here).
  const reserved = await sql.reserve();
  for (;;) {
    const [{ ok }] = await reserved`select pg_try_advisory_lock(${LOCK}) as ok`;
    if (ok) break;
    log("another keeper holds the lock; standing by");
    await new Promise((r) => setTimeout(r, LOOP_MS));
  }
  await ensureSchema().catch((e) => log("schema registration failed; attestations wait for it:", (e as Error).message));
  healthy = true;
  log("running");
  for (;;) {
    try {
      await loop();
    } catch (e) {
      log("loop failed:", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, LOOP_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
