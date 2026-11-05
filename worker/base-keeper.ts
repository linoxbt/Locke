// Locke's keeper. Long-lived: run it on Railway as its own service.
//
// Every 15 seconds, for each vault not closed:
// - reads the vault on Base (idle USDC, plan limits, pause, keeper, cooldown) and its hedge on
//   Veranta (position, signed price, market hours);
// - decides with src/lib/base/keeper.ts: open the hedge once the deposit is in, add margin when it
//   runs thin, mark the vault closed when the owner closed the hedge;
// - sends the transaction from the keeper key, with Locke's Builder Code appended, and records
//   what happened for the vault page;
// - issues a "Protected by Locke" attestation on EAS once the hedge is open, and revokes it once
//   the vault closes (src/lib/base/attest.ts);
// - for owners who turned on "Protect as you get paid", counts USDC arriving in their Base Account
//   and moves their chosen share into the vault under their spend permission (src/lib/base/income.ts).
// The keeper key can only trade within each vault's on-chain limits; it can never withdraw.
// /healthz answers 503 when rounds stop finishing, vaults keep failing, the keeper is low on gas
// money or its key is revoked. A Postgres advisory lock keeps an overlapping deploy on standby
// (healthy while it keeps checking); SIGTERM finishes the vault in hand and exits.
// Every transaction is signed and its hash recorded before it is broadcast, so a crash never
// leaves one Locke doesn't know it sent.

import http from "node:http";
import {
  concatHex,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  getAddress,
  http as httpTransport,
  keccak256,
  parseAbiItem,
  parseEther,
  parseEventLogs,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { EAS_ADDRESS, easAbi, PROTECTION_SCHEMA, PROTECTION_SCHEMA_UID, protectionRequest, SCHEMA_REGISTRY_ADDRESS, schemaRegistryAbi } from "../src/lib/base/attest";
import { builderSuffix } from "../src/lib/base/builderCode";
import { baseMarket, erc20Abi, factoryAbi, fromUsdcUnits, tradingStorageAbi, LAZER_FEE_WEI, P10, PRICE_SOURCING_LAZER, USDC, usdcUnits, vaultAbi } from "../src/lib/base/contracts";
import { collectIncomeAbi, incomeUsd, nextCollectionUsd, onChain, SPEND_PERMISSION_MANAGER, spendPermissionManagerAbi, type SpendPermission } from "../src/lib/base/income";
import { decide, TOP_UP_COOLDOWN_S, type VaultState, type VaultStatus } from "../src/lib/base/keeper";
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
/** Below this the keeper may soon be unable to pay for its transactions (on Base one costs about 0.000001–0.00003 ETH, so this still covers well over a hundred): health goes red well before it runs out. */
const MIN_GAS_ETH = parseEther("0.0002");
/** Blocks of USDC transfers read per call when counting income (public RPCs cap log ranges). */
const SCAN_BLOCKS = 1000n;
const USDC_TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
/** Repeat a "needs attention" event at most this often per vault. */
const NOTICE_EVERY_MS = 30 * 60_000;

const account = privateKeyToAccount(config.baseKeeperKey);
const client = basePublicClient();
const suffix = builderSuffix(config.baseBuilderCode);
const wallet = createWalletClient({ account, chain: base, transport: httpTransport(config.baseRpcUrl) });
const lastNotice = new Map<string, { note: string; at: number }>();
let healthy = false;
let lastLoopOk = 0;
let gasLow = false;
let failing = 0;
let schemaReady = false;
/** Locke's guardian revoked this keeper key for every vault: nothing it sends would be accepted. */
let keeperRevoked = false;
/** Set on SIGTERM: finish the vault in hand, start nothing new, exit. */
let stopping = false;
/** A transaction signed and recorded but not broadcast, or broadcast and not seen since, is given up after this long. */
const DROPPED_AFTER_MS = 10 * 60_000;

/**
 * Sign a call, let the caller record its hash, then broadcast it. Recording before the broadcast
 * means a crash at any point leaves a hash to look up, never a transaction Locke doesn't know it
 * sent. Locke's Builder Code rides on the calldata (ERC-8021; contracts ignore it).
 */
/** What is kept of a signed transaction so it can be looked up, or sent again, after a restart. */
interface Signed {
  nonce: number;
  raw: Hex;
}

async function broadcast(
  call: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint },
  record?: (hash: Hex, signed: Signed) => Promise<unknown>
): Promise<Hex> {
  const data = encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args } as never);
  const prepared = await wallet.prepareTransactionRequest({
    account,
    chain: base,
    to: call.address,
    data: suffix ? concatHex([data, suffix]) : data,
    value: call.value ?? 0n,
  });
  const signed = await wallet.signTransaction(prepared as never);
  const hash = keccak256(signed);
  await record?.(hash, { nonce: Number(prepared.nonce), raw: signed });
  await client.sendRawTransaction({ serializedTransaction: signed });
  return hash;
}

/**
 * "mined"; "dropped" only once another transaction of the keeper's has used its nonce, so it can
 * never land later; otherwise "pending", and the stored signed transaction is sent again (the
 * same bytes: it can land at most once). Without a stored nonce, an old record falls back to
 * asking the node about the hash.
 */
async function txState(hash: Hex, signed?: Partial<Signed> | null): Promise<"mined" | "pending" | "dropped"> {
  const mined = async () => !!(await client.getTransactionReceipt({ hash }).catch(() => null));
  if (await mined()) return "mined";
  if (signed?.nonce == null) return (await client.getTransaction({ hash }).catch(() => null)) ? "pending" : "dropped";
  const used = await client.getTransactionCount({ address: account.address, blockTag: "latest" });
  if (used > signed.nonce) return (await mined()) ? "mined" : "dropped";
  if (signed.raw) await client.sendRawTransaction({ serializedTransaction: signed.raw }).catch(() => null);
  return "pending";
}
/** Each vault's Veranta TradingStorage (fixed at creation) and how many looks in a row it showed no trade. */
const storageOf = new Map<string, Address>();
const goneRounds = new Map<string, number>();

interface Row {
  address: string;
  pair_index: number;
  status: VaultStatus;
  sizing: BaseSizing;
  risk_level: RiskLevel;
  status_note: string | null;
  open_sent_at: Date | null;
  opened_at: Date | null;
  topup_sent_at: Date | null;
  topup_from_usd: string | null;
}

async function snapshot(row: Row): Promise<VaultState> {
  const vault = getAddress(row.address);
  const pair = BigInt(row.pair_index);
  const read = <T>(functionName: string, args: unknown[] = []) =>
    client.readContract({ address: vault, abi: vaultAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
  let storage = storageOf.get(row.address);
  if (!storage) {
    storage = await read<Address>("tradingStorage");
    storageOf.set(row.address, storage);
  }
  const onBase = (functionName: "openTradesCount" | "pendingMarketOpenCount") =>
    client.readContract({ address: storage!, abi: tradingStorageAbi, functionName, args: [vault, pair] });
  const [idle, plan, paused, keeper, lastOpen, block, positions, price, market, openTrades, pendingOpens, lastTopUp, owed] = await Promise.all([
    client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [vault] }),
    read<readonly [boolean, boolean, bigint, bigint, bigint]>("plans", [pair]),
    read<boolean>("paused"),
    read<Address>("keeper"),
    read<bigint>("lastOpenAt", [pair]),
    client.getBlock(),
    getPositions(row.address, { pairIndex: row.pair_index }),
    getSignedPrice(row.pair_index),
    getMarket(row.pair_index),
    onBase("openTradesCount"),
    onBase("pendingMarketOpenCount"),
    read<bigint>("lastTopUpAt", [pair]),
    read<bigint>("feeOwed", [pair]),
  ]);
  const chainTrades = Number(openTrades) + Number(pendingOpens);
  const gone = chainTrades === 0 ? (goneRounds.get(row.address) ?? 0) + 1 : 0;
  goneRounds.set(row.address, gone);
  const cooldownEnds = Number(lastOpen) + 3600;
  // The hedge's margin as Base holds it: the API can lag a top-up by a while, and sizing the next
  // top-up from its figure would send the same margin twice.
  let position = positions.find((p) => p.pairIndex === row.pair_index) ?? null;
  if (position && Number(openTrades) > 0) {
    const trade = await client.readContract({ address: storage, abi: tradingStorageAbi, functionName: "openTrades", args: [vault, pair, BigInt(position.index)] });
    const onChain = fromUsdcUnits(trade.initialPosToken);
    if (onChain > 0) position = { ...position, collateralUsd: onChain };
  }
  // A top-up in flight ends once Base shows a different margin (it applied), or after its retry window.
  let topUpSentAgoS = row.topup_sent_at ? (Date.now() - row.topup_sent_at.getTime()) / 1000 : null;
  if (topUpSentAgoS != null && (!position || Math.abs(position.collateralUsd - Number(row.topup_from_usd ?? 0)) > 0.005)) {
    await db()`update base_vaults set topup_sent_at = null, topup_from_usd = null where address = ${row.address}`;
    topUpSentAgoS = null;
  }
  return {
    status: row.status,
    sizing: row.sizing,
    prevLevel: row.risk_level,
    // A fee still owed is paid from idle USDC before any margin moves, so it isn't there to use.
    idleUsd: Math.max(0, fromUsdcUnits(idle) - fromUsdcUnits(owed)),
    planEnabled: plan[0],
    maxLeverage: Number(plan[2]) / 1e10,
    maxNotionalUsd: fromUsdcUnits(plan[3]),
    maxCollateralUsd: fromUsdcUnits(plan[4]),
    position,
    mark: price?.price ?? null,
    marketOpen: market.marketOpen && !!price,
    closeOnly: market.closeOnly || !market.listed,
    paused,
    keeperIsUs: keeper.toLowerCase() === account.address.toLowerCase() && !keeperRevoked,
    cooldownLeftS: Math.max(0, cooldownEnds - Number(block.timestamp)),
    openSentAgoS: row.open_sent_at ? (Date.now() - row.open_sent_at.getTime()) / 1000 : null,
    chainTrades,
    goneRounds: gone,
    topUpSentAgoS,
    topUpCooldownLeftS: Math.max(0, Number(lastTopUp) + TOP_UP_COOLDOWN_S - Number(block.timestamp)),
  };
}

async function send(
  vault: Address,
  functionName: "hedgeOpen" | "topUpMargin" | "settleFee",
  args: readonly unknown[],
  value = 0n,
  beforeSend?: (hash: Hex) => Promise<unknown>
): Promise<Hex> {
  // Simulate first: a revert costs nothing and says why. Only then record that it is being sent.
  await client.simulateContract({ account, address: vault, abi: vaultAbi, functionName, args: args as never, value: value as never });
  const hash = await broadcast({ address: vault, abi: vaultAbi as Abi, functionName, args, value }, beforeSend);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted in ${hash}`);
  return hash;
}

/** Why an action failed, in words an owner can read: a contract's own error, or Base/Veranta being unreachable. */
function reason(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string; cause?: { data?: { errorName?: string } } };
  const name = err.cause?.data?.errorName ?? /reverted with the following reason:\s*\n?\s*(\w+)|Error: (\w+)\(/.exec(err.shortMessage ?? err.message ?? "")?.slice(1).find(Boolean);
  const known: Record<string, string> = {
    NotKeeper: "Locke's keeper isn't allowed on this vault",
    IsPaused: "Locke has paused new hedges",
    PlanDisabled: "the vault's plan is turned off",
    NotionalTooHigh: "it would pass the vault's limit",
    CollateralTooHigh: "it would pass the vault's limit",
    LeverageTooHigh: "it would pass the vault's leverage limit",
    TooSoon: "the vault allows one open per hour and one top-up every two minutes",
    ZeroPrice: "Veranta gave no price",
    PositionExists: "an order is already pending on Veranta",
  };
  if (name && known[name]) return known[name];
  const text = err.shortMessage ?? err.message ?? String(e);
  if (/insufficient funds/i.test(text)) return "Locke's keeper is out of gas money";
  return text.split("\n")[0].slice(0, 160);
}

/** Consecutive failed rounds per vault: shown to the owner after a minute, and counted in health. */
const failures = new Map<string, number>();
const FAILURE_NOTE_AFTER = 4;
const FAILURE_NOTE_PREFIX = "Locke couldn't act on this vault in the last minute:";

async function failed(row: Row, e: unknown) {
  const n = (failures.get(row.address) ?? 0) + 1;
  failures.set(row.address, n);
  log("vault", row.address, `failed (${n} in a row):`, reason(e));
  if (n === FAILURE_NOTE_AFTER) {
    await note(row.address, `${FAILURE_NOTE_PREFIX} ${reason(e)}. It keeps retrying every 15 seconds.`, "action").catch(() => null);
  }
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
  if (row.status !== "active" && d.status === "active") await addVaultEvent(row.address, "info", "Hedge open on Veranta: the vault is protected");
  // Locke's fee is owed from the open and paid once Base shows the trade (whatever the API says yet).
  // Never holds up the hedge; the next round retries.
  if (state.chainTrades > 0) await settleFee(row).catch((e) => log("settleFee", row.address, "failed:", reason(e)));
  // The public proof follows the hedge.
  if (d.status === "active") await attest(row).catch((e) => log("attest", row.address, "failed:", reason(e)));
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
      if (!price) return note(row.address, "No price from Veranta right now; opening shortly.");
      const lev = BigInt(Math.round(a.leverage * 1e10));
      const hash = await send(vault, "hedgeOpen", [BigInt(row.pair_index), usdcUnits(a.collateralUsd), lev, BigInt(Math.round(price.price * 1e10)), SLIPPAGE], 0n, () =>
        sql`update base_vaults set open_sent_at = now(), status = 'opening', updated_at = now() where address = ${row.address}`
      );
      log("opened", row.address, a, hash);
      await addVaultEvent(row.address, "info", `Hedge sent to Veranta: ${row.sizing.buy ? "long" : "short"} $${row.sizing.notionalUsd.toFixed(2)} at ${a.leverage}x`, undefined, hash);
      return note(row.address, "Waiting for Veranta to fill the hedge.");
    }
    case "topUp": {
      const price = await getSignedPrice(row.pair_index);
      if (!price) return note(row.address, "No price from Veranta right now; adding margin shortly.");
      const from = state.position?.collateralUsd ?? 0;
      const hash = await send(vault, "topUpMargin", [BigInt(row.pair_index), BigInt(a.index), usdcUnits(a.amountUsd), [price.updateData], PRICE_SOURCING_LAZER], LAZER_FEE_WEI, () =>
        // Recorded before sending: a receipt timeout or a restart waits for this top-up instead of sending another.
        sql`update base_vaults set topup_sent_at = now(), topup_from_usd = ${from}, updated_at = now() where address = ${row.address}`
      );
      log("topped up", row.address, a, hash);
      await addVaultEvent(row.address, "action", `Added $${a.amountUsd.toFixed(2)} of margin from the vault's buffer`, undefined, hash);
      return note(row.address, null);
    }
  }
}

async function settleFee(row: Row) {
  const vault = getAddress(row.address);
  const pair = BigInt(row.pair_index);
  const owed = (await client.readContract({ address: vault, abi: vaultAbi, functionName: "feeOwed", args: [pair] })) as bigint;
  if (owed === 0n) return;
  // The vault pays what it holds idle; with less than the fee there, sending would only part-pay it
  // (or pay nothing) and spend gas every round. It is paid once the vault holds enough.
  const idle = await client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [vault] });
  if (idle < owed) return;
  // Paid only once the trade exists: while the order is still pending, there is nothing to send.
  const storage = storageOf.get(row.address);
  if (storage && (await client.readContract({ address: storage, abi: tradingStorageAbi, functionName: "openTradesCount", args: [vault, pair] })) === 0n) return;
  const hash = await send(vault, "settleFee", [BigInt(row.pair_index)]);
  log("settled fee", row.address, Number(owed) / 1e6, hash);
}

/**
 * An attestation sent but not yet recorded (the receipt timed out, or the process stopped):
 * recorded from its receipt now, so it is never issued twice or left unrevocable. True while it
 * is still unresolved.
 */
async function resolvePendingAttestation(address: string): Promise<boolean> {
  const [pending] = await db()`
    select e.detail->>'attestTx' as tx, e.detail->>'nonce' as nonce, e.detail->>'raw' as raw, e.created_at from base_vault_events e
    where e.vault = ${address} and e.detail ? 'attestTx'
      and not exists (select 1 from base_vault_events r where r.vault = e.vault and r.detail->>'tx' = e.detail->>'attestTx')
    order by e.id desc limit 1`;
  if (!pending) return false;
  const hash = pending.tx as Hex;
  const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt) {
    // Not mined: still waiting (sent again if need be), unless it can no longer land. Then it is
    // closed off so a new one can be issued.
    const old = Date.now() - new Date(pending.created_at).getTime() > DROPPED_AFTER_MS;
    const signed = pending.nonce == null ? null : { nonce: Number(pending.nonce), raw: pending.raw as Hex };
    if ((old || signed) && (await txState(hash, signed)) === "dropped") {
      await addVaultEvent(address, "info", "The proof didn't publish; Locke tries again", { tx: hash, failed: true }, hash);
      return false;
    }
    return true;
  }
  const [ev] = receipt.status === "success" ? parseEventLogs({ abi: easAbi, logs: receipt.logs, eventName: "Attested" }) : [];
  if (ev) await addVaultEvent(address, "info", "Protected by Locke: proof published on Base", { attestation: ev.args.uid, tx: hash }, hash);
  else await addVaultEvent(address, "info", "The proof didn't publish; Locke tries again", { tx: hash, failed: true }, hash);
  return false;
}

/** Issue the vault's "Protected by Locke" attestation to its owner, unless it already has one. */
async function attest(row: Row) {
  if (await resolvePendingAttestation(row.address)) return;
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
  await client.simulateContract({ account, address: EAS_ADDRESS, abi: easAbi, functionName: "attest", args: [request] });
  // Recorded before it is broadcast, so a timeout or restart resolves this transaction instead of sending another.
  const hash = await broadcast({ address: EAS_ADDRESS, abi: easAbi as Abi, functionName: "attest", args: [request] }, (h, s) =>
    addVaultEvent(row.address, "info", "Publishing the Protected by Locke proof on Base", { attestTx: h, nonce: s.nonce, raw: s.raw }, h)
  );
  await client.waitForTransactionReceipt({ hash, timeout: 90_000 }).catch(() => null);
  await resolvePendingAttestation(row.address);
  log("attest sent", row.address, hash);
}

/**
 * Revoke the attestation of every vault that has closed, so the proof never outlives the hedge:
 * one issued, or one still being published when the vault closed. Only vaults with such a proof
 * left are read, a few at a time.
 */
async function revokeClosed() {
  const rows = await db()`
    select v.address from base_vaults v where v.status = 'closed' and (
      exists (select 1 from base_vault_events e where e.vault = v.address and e.detail ? 'attestation'
              and not exists (select 1 from base_vault_events r where r.vault = e.vault and r.detail->>'revoked' = e.detail->>'attestation'))
      or exists (select 1 from base_vault_events e where e.vault = v.address and e.detail ? 'attestTx'
              and not exists (select 1 from base_vault_events r where r.vault = e.vault and r.detail->>'tx' = e.detail->>'attestTx')))
    order by v.closed_at limit 10`;
  for (const { address } of rows) {
    if (await resolvePendingAttestation(address).catch(() => true)) continue;
    const uid = await activeAttestation(address);
    if (!uid) continue;
    try {
      // Already revoked (a revoke whose receipt timed out last round): just record it.
      const current = await client.readContract({ address: EAS_ADDRESS, abi: easAbi, functionName: "getAttestation", args: [uid as Hex] });
      if (current.revocationTime > 0n) {
        await addVaultEvent(address, "info", "Vault closed: the Protected by Locke proof is revoked", { revoked: uid });
        continue;
      }
      const args = [{ schema: PROTECTION_SCHEMA_UID, data: { uid: uid as Hex, value: 0n } }] as const;
      await client.simulateContract({ account, address: EAS_ADDRESS, abi: easAbi, functionName: "revoke", args });
      const hash = await broadcast({ address: EAS_ADDRESS, abi: easAbi as Abi, functionName: "revoke", args });
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
  inflight_tx: Hex | null;
  inflight_usd: string | null;
  inflight_at: Date | null;
  inflight_nonce: number | null;
  inflight_raw: Hex | null;
}

/** Blocks a USDC transfer must be under before it counts as income (shallow reorgs). */
const INCOME_CONFIRMATIONS = 2n;
/** A sent collection with no receipt after this long was dropped: forget it and try again. */
const INFLIGHT_DROPPED_MS = 10 * 60_000;

/** "Protect as you get paid", for every vault that has it on. */
async function collectIncome() {
  let rows: IncomeRow[];
  try {
    rows = (await db()`
      select i.vault, v.status as vault_status, i.permission, i.signature, i.share_pct, i.pending_usd, i.last_block,
             i.inflight_tx, i.inflight_usd, i.inflight_at, i.inflight_nonce, i.inflight_raw
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

  // A collection still in flight is booked (or forgotten) before anything new is sent.
  if (r.inflight_tx) {
    const booked = await bookCollection(r.vault, r.inflight_tx, Number(r.inflight_usd));
    // Forgotten only once the node has never heard of it: one still in a mempool can still land.
    const signed = r.inflight_nonce == null ? null : { nonce: Number(r.inflight_nonce), raw: r.inflight_raw ?? undefined };
    const old = r.inflight_at && Date.now() - new Date(r.inflight_at).getTime() > INFLIGHT_DROPPED_MS;
    if (booked === "waiting" && (old || signed) && (await txState(r.inflight_tx, signed)) === "dropped") {
      await sql`update base_income set inflight_tx = null, inflight_usd = null, inflight_at = null, inflight_nonce = null, inflight_raw = null
                where vault = ${r.vault} and inflight_tx = ${r.inflight_tx}`;
      log("income", r.vault, "collection dropped:", r.inflight_tx);
    }
    return;
  }

  // Count the owner's new income, a block range at a time, a couple of blocks behind the head.
  let pending = Number(r.pending_usd);
  const head = latest - INCOME_CONFIRMATIONS;
  const from = BigInt(r.last_block) + 1n;
  if (from <= head) {
    const to = head < from + SCAN_BLOCKS - 1n ? head : from + SCAN_BLOCKS - 1n;
    const logs = await client.getLogs({ address: USDC, event: USDC_TRANSFER, args: { to: p.account }, fromBlock: from, toBlock: to });
    // Withdrawals from any of this owner's Locke vaults aren't income.
    const own = await sql`select address from base_vaults where user_id = (select user_id from base_vaults where address = ${r.vault})`;
    const income = incomeUsd(logs.map((l) => ({ from: l.args.from!, valueUsd: Number(l.args.value!) / 1e6 })), p.account, [vault, ...own.map((v) => v.address as string)]);
    const add = (income * r.share_pct) / 100;
    // Only if nothing changed since this round read the row (the owner turning it off and on resets it).
    const [moved] = await sql`update base_income set last_block = ${to.toString()}, pending_usd = pending_usd + ${add}, updated_at = now()
                              where vault = ${r.vault} and last_block = ${r.last_block} and status = 'on' returning vault`;
    if (!moved) return;
    pending += add;
  }

  // Move what's owed, within this week's allowance.
  const period = await manager<{ spend: bigint }>("getCurrentPeriod");
  const amount = nextCollectionUsd(pending, Number(p.allowance - period.spend) / 1e6);
  if (amount == null) return;
  const keeper = (await client.readContract({ address: vault, abi: vaultAbi, functionName: "keeper" })) as Address;
  if (keeper.toLowerCase() !== account.address.toLowerCase()) return; // the owner removed Locke's keeper
  const approved = await manager<boolean>("isApproved");
  const args = [p, approved ? "0x" : r.signature, usdcUnits(amount)] as const;
  await client.simulateContract({ account, address: vault, abi: collectIncomeAbi, functionName: "collectIncome", args });
  // Marked before it is broadcast: a timeout or restart books this transaction next round instead of sending another.
  const hash = await broadcast({ address: vault, abi: collectIncomeAbi as Abi, functionName: "collectIncome", args }, (h, s) =>
    sql`update base_income set inflight_tx = ${h}, inflight_usd = ${amount}, inflight_at = now(), inflight_nonce = ${s.nonce}, inflight_raw = ${s.raw} where vault = ${r.vault}`
  );
  await client.waitForTransactionReceipt({ hash, timeout: 90_000 }).catch(() => null);
  await bookCollection(r.vault, hash, amount);
}

/** Book a sent collection from its receipt, once. "waiting" while it has no receipt yet. */
async function bookCollection(vaultAddr: string, hash: Hex, amount: number): Promise<"booked" | "failed" | "waiting"> {
  const sql = db();
  const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt) return "waiting";
  if (receipt.status !== "success") {
    await sql`update base_income set inflight_tx = null, inflight_usd = null, inflight_at = null, inflight_nonce = null, inflight_raw = null where vault = ${vaultAddr} and inflight_tx = ${hash}`;
    log("income", vaultAddr, "collection reverted:", hash);
    return "failed";
  }
  const [row] = await sql`
    update base_income set pending_usd = greatest(pending_usd - ${amount}, 0), collected_usd = collected_usd + ${amount},
      last_collected_at = now(), inflight_tx = null, inflight_usd = null, inflight_at = null, inflight_nonce = null, inflight_raw = null, updated_at = now()
    where vault = ${vaultAddr} and inflight_tx = ${hash} returning vault`;
  if (row) {
    log("collected income", vaultAddr, amount, hash);
    await addVaultEvent(vaultAddr, "info", `Moved $${amount.toFixed(2)} of incoming USDC into the vault`, undefined, hash);
  }
  return "booked";
}

/** EAS assigns the schema its id from its text; register it the first time any keeper runs. */
async function ensureSchema() {
  const known = await client.readContract({ address: SCHEMA_REGISTRY_ADDRESS, abi: schemaRegistryAbi, functionName: "getSchema", args: [PROTECTION_SCHEMA_UID] });
  if (known.uid === PROTECTION_SCHEMA_UID) {
    schemaReady = true;
    return;
  }
  const args = [PROTECTION_SCHEMA, zeroAddress, true] as const;
  await client.simulateContract({ account, address: SCHEMA_REGISTRY_ADDRESS, abi: schemaRegistryAbi, functionName: "register", args });
  const hash = await broadcast({ address: SCHEMA_REGISTRY_ADDRESS, abi: schemaRegistryAbi as Abi, functionName: "register", args });
  await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  schemaReady = true;
  log("registered the Protected by Locke schema", PROTECTION_SCHEMA_UID, hash);
}

/** Vaults failing this many rounds in a row (about two minutes) make the keeper unhealthy. */
const UNHEALTHY_AFTER = 8;

async function loop() {
  // Live hedges first, the most at risk first: a slow vault mustn't delay a margin top-up.
  const rows = (await db()`
    select address, pair_index, status, sizing, risk_level, status_note, open_sent_at, opened_at, topup_sent_at, topup_from_usd
    from base_vaults where status <> 'closed'
    order by case status when 'active' then 0 else 1 end, last_ratio desc nulls last, created_at`) as unknown as Row[];
  const problems: string[] = [];
  // Revoked for every vault by Locke's guardian: say so on each vault instead of failing every round.
  keeperRevoked = await client
    .readContract({ address: config.baseFactoryAddress!, abi: factoryAbi, functionName: "keeperRevoked", args: [account.address] })
    .catch(() => keeperRevoked);
  // Vaults no longer tended (closed, or gone) drop out of the failure count.
  const live = new Set(rows.map((r) => r.address));
  for (const k of failures.keys()) if (!live.has(k)) failures.delete(k);
  for (const row of rows) {
    if (stopping) break;
    try {
      await tend(row);
      // Recovered: drop the failure note (only that note: tend may have just written a real one).
      if (failures.delete(row.address)) {
        await db()`update base_vaults set status_note = null where address = ${row.address} and status_note like ${FAILURE_NOTE_PREFIX + "%"}`.catch(() => null);
      }
    } catch (e) {
      await failed(row, e);
    }
  }
  // Each of these failing is logged and reported, but never stops the heartbeat below.
  if (!stopping) await revokeClosed().catch((e) => problems.push(`revoke: ${reason(e)}`));
  if (!stopping) await collectIncome().catch((e) => problems.push(`income: ${reason(e)}`));
  await client
    .getBalance({ address: account.address })
    .then((gas) => {
      gasLow = gas < MIN_GAS_ETH;
      if (gasLow) log(`keeper ${account.address} is low on ETH: ${formatEther(gas)}`);
    })
    .catch((e) => problems.push(`gas balance: ${reason(e)}`));
  failing = [...failures.values()].filter((n) => n >= UNHEALTHY_AFTER).length;
  for (const p of problems) log(p);
  lastLoopOk = Date.now();
  // The app's /api/health reads this to know the keeper is alive and well.
  await db()`insert into monitor_heartbeat (id, at, result) values (2, now(), ${db().json({ source: "base-keeper", vaults: rows.length, failing, gasLow, keeperRevoked, problems } as never)})
             on conflict (id) do update set at = excluded.at, result = excluded.result`.catch((e) => log("heartbeat failed:", reason(e)));
}

/**
 * Supabase serves the same database through its transaction pooler (port 6543) and its session
 * pooler (5432) on the same host and credentials. The keeper needs a session (for its lock), so a
 * Supabase transaction-pooler URL, the one the websites use, is switched to the session pooler.
 */
function sessionPoolerUrl(url: string): string {
  // Shared pooler (aws-…pooler.supabase.com) and dedicated pooler (db.<ref>.supabase.co) alike.
  return url.replace(/(\.pooler\.supabase\.com|\.supabase\.co):6543\b/, "$1:5432");
}

async function main() {
  if (!config.baseFactoryAddress) throw new Error("BASE_FACTORY_ADDRESS is not set");
  const original = config.databaseUrl;
  process.env.DATABASE_URL = sessionPoolerUrl(original);
  if (process.env.DATABASE_URL !== original) log("DATABASE_URL is Supabase's transaction pooler; using its session pooler (port 5432) instead");
  const sql = db();
  const port = Number(process.env.PORT ?? 8080);
  // While a new deploy waits for the old keeper's lock it is ready to take over: it answers healthy,
  // so the platform can retire the old one (which releases the lock) instead of failing the deploy.
  let standby = true;
  // Standing by is healthy only while it is still checking for the lock (the database answers).
  let lastStandbyCheck = Date.now();
  http
    .createServer((req, res) => {
      if (req.url !== "/healthz") return res.writeHead(404).end();
      const ok = standby
        ? Date.now() - lastStandbyCheck < 4 * LOOP_MS
        : healthy && !stopping && !gasLow && !keeperRevoked && failing === 0 && Date.now() - lastLoopOk < 4 * LOOP_MS;
      res
        .writeHead(ok ? 200 : 503, { "content-type": "application/json" })
        .end(JSON.stringify({ ok, standby, keeper: account.address, gasLow, keeperRevoked, failing, lastLoopOk }));
    })
    .listen(port, () => log(`health on :${port}/healthz, keeper ${account.address}`));

  // A redeploy or shutdown: finish the vault in hand (a transaction mid-flight is recorded either
  // way), then exit, so the next keeper takes the lock cleanly.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      log(`${signal}: finishing the current round, then exiting`);
      setTimeout(() => process.exit(0), 60_000).unref();
    });
  }

  // One active keeper: wait for the lock (a deploy overlapping the old one waits here). A session
  // lock needs a session, which a transaction pooler (port 6543) can't hold: refuse to run on one
  // that couldn't be switched rather than run unguarded beside another keeper.
  if (/:6543\b/.test(config.databaseUrl)) throw new Error("DATABASE_URL is a transaction pooler (port 6543); use a session pooler (5432) or a direct connection");
  const reserved = await sql.reserve();
  for (;;) {
    if (stopping) process.exit(0);
    const [{ ok }] = await reserved`select pg_try_advisory_lock(${LOCK}) as ok`;
    lastStandbyCheck = Date.now();
    if (ok) break;
    log("another keeper holds the lock; standing by");
    await new Promise((r) => setTimeout(r, LOOP_MS));
  }
  standby = false;
  // The lock must still be ours: if its connection drops or hangs, or the lock is gone, another
  // keeper may start, so stop at once. A round stuck far past its time also ends the process,
  // for the platform to restart it.
  const watchdog = async () => {
    const held = await Promise.race([
      reserved`select count(*)::int as n from pg_locks where locktype = 'advisory' and objid = ${LOCK} and pid = pg_backend_pid() and granted`.then(([r]) => r.n > 0),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000)),
    ]).catch(() => false);
    if (!held) {
      log("lost the keeper lock (or its connection); exiting so only one keeper runs");
      process.exit(1);
    }
    if (healthy && lastLoopOk && Date.now() - lastLoopOk > 20 * LOOP_MS) {
      log("no round has finished in five minutes; exiting so the platform restarts the keeper");
      process.exit(1);
    }
  };
  setInterval(() => void watchdog(), LOOP_MS).unref();
  await ensureSchema().catch((e) => log("schema registration failed; attestations wait for it:", reason(e)));
  healthy = true;
  log("running");
  for (;;) {
    if (stopping) process.exit(0);
    try {
      await loop();
    } catch (e) {
      log("loop failed:", (e as Error).message);
    }
    if (stopping) {
      log("stopped");
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, LOOP_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
