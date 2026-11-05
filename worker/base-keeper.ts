// Locke's keeper. Long-lived: run it on Railway as its own service.
//
// Every 15 seconds, for each vault not closed (a few at a time; one still waiting for its deposit
// every few minutes, and not at all once it has waited a week, until the deposit is seen):
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
// (healthy while it keeps checking); SIGTERM finishes the vaults in hand and exits.
// Transactions go out one at a time. Every one is signed and its hash recorded before it is
// broadcast, so a crash never leaves one Locke doesn't know it sent; one stuck for a minute is
// signed again at its nonce with higher fees.

import http from "node:http";
import {
  concatHex,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  getAddress,
  http as httpTransport,
  isAddressEqual,
  keccak256,
  parseAbiItem,
  parseEther,
  parseEventLogs,
  parseTransaction,
  recoverTransactionAddress,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { EAS_ADDRESS, easAbi, PROTECTION_SCHEMA, PROTECTION_SCHEMA_UID, protectionRequest, SCHEMA_REGISTRY_ADDRESS, schemaRegistryAbi } from "../src/lib/base/attest";
import { builderSuffix } from "../src/lib/base/builderCode";
import { baseMarket, erc20Abi, factoryAbi, fromUsdcUnits, tradingStorageAbi, LAZER_FEE_WEI, P10, PRICE_SOURCING_LAZER, USDC, usdcUnits, vaultAbi } from "../src/lib/base/contracts";
import { collectIncomeAbi, incomeUsd, nextCollectionUsd, onChain, SPEND_PERMISSION_MANAGER, spendPermissionManagerAbi, type SpendPermission } from "../src/lib/base/income";
import { decide, depositNeededUsd, openTerms, TOP_UP_COOLDOWN_S, withChainTrade, type VaultState, type VaultStatus } from "../src/lib/base/keeper";
import type { BaseSizing } from "../src/lib/domain/basePlans";
import type { RiskLevel } from "../src/lib/domain/types";
import { basePublicClient } from "../src/lib/server/baseChain";
import { activeAttestation, addVaultEvent } from "../src/lib/server/baseVaults";
import { config } from "../src/lib/server/config";
import { db } from "../src/lib/server/db";
import { getMarket, getPositions, getSignedPrice, UnlistedMarketError } from "../src/lib/veranta/client";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[base-keeper]", ...a);

const LOOP_MS = 15_000;
const LOCK = 7_310_001; // advisory lock id: one active Base keeper
/** Slippage allowed on an open: 1% (Veranta's 1e10 = 1%). */
const SLIPPAGE = P10;
/** Below this the keeper may soon be unable to pay for its transactions (on Base one costs about 0.000001–0.00003 ETH, so this still covers well over a hundred): health goes red well before it runs out. */
const MIN_GAS_ETH = parseEther("0.0002");
/** Below this (2.5× the floor) the heartbeat warns, so the keeper is topped up before health goes red. */
const WARN_GAS_ETH = (MIN_GAS_ETH * 5n) / 2n;
/** Vaults read and decided at once; their transactions still go out one at a time. */
const CONCURRENCY = 5;
/** A vault waiting for its deposit is looked at this often rather than every round. */
const FUNDING_LOOK_MS = 3 * 60_000;
/** A vault still short of its deposit this long after it was created is set aside (dormant_at) until it is funded. */
const DORMANT_AFTER_MS = 7 * 24 * 3600_000;
/** Vaults set aside are checked for a deposit this often, a batch at a time. */
const DORMANT_SWEEP_MS = 60 * 60_000;
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
/** Set on SIGTERM: finish the vaults in hand, start nothing new, exit. */
let stopping = false;
/** A transaction signed and recorded but not broadcast, or broadcast and not seen since, is given up after this long. */
const DROPPED_AFTER_MS = 10 * 60_000;

/** What is kept of a signed transaction so it can be looked up, or sent again, after a restart. */
interface Signed {
  nonce: number;
  raw: Hex;
}

/**
 * A sent transaction followed across rounds: its hashes (earlier ones were replaced with higher
 * fees at the same nonce, and any one of them may be the one that lands), and the latest signed.
 */
interface Tracked {
  hashes: Hex[];
  nonce?: number;
  raw?: Hex;
  /** When the latest was signed (ms). */
  signedAt: number;
}

type Call = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint };
/** Records a replacement before it is broadcast, as `record` does for the first. */
type Replace = (prev: Hex, next: Signed & { hash: Hex }) => Promise<unknown>;

/** Wait this long for a receipt before sending a stuck transaction again with higher fees. */
const BUMP_AFTER_MS = 60_000;
/** A nonce used with no receipt for any of its hashes is called dropped only after this many blocks (the node answering may lag). */
const DROP_CONFIRM_BLOCKS = 15n;

/**
 * Sends from the keeper key go through this queue one at a time, each waited for before the next,
 * so two never take the same nonce. Reads and decisions for other vaults go on meanwhile.
 */
let sendQueue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = sendQueue.then(fn, fn);
  sendQueue = run.catch(() => null);
  return run;
}

/**
 * Sign a call, let the caller record its hash, then broadcast it. Recording before the broadcast
 * means a crash at any point leaves a hash to look up, never a transaction Locke doesn't know it
 * sent. Locke's Builder Code rides on the calldata (ERC-8021; contracts ignore it). In the queue only.
 */
async function broadcast(call: Call, record?: (hash: Hex, signed: Signed) => Promise<unknown>): Promise<Tracked> {
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
  return { hashes: [hash], nonce: Number(prepared.nonce), raw: signed, signedAt: Date.now() };
}

/** The receipt of whichever of these hashes was mined, if this node has it. */
async function minedOf(hashes: Hex[]): Promise<TransactionReceipt | null> {
  for (const hash of hashes) {
    const r = await client.getTransactionReceipt({ hash }).catch(() => null);
    if (r) return r;
  }
  return null;
}

async function waitMined(hashes: Hex[], ms: number): Promise<TransactionReceipt | null> {
  const end = Date.now() + ms;
  for (;;) {
    const r = await minedOf(hashes);
    if (r || Date.now() > end) return r;
    await new Promise((res) => setTimeout(res, 2_000));
  }
}

/** True when the receipt is the call itself, not the transfer that freed its nonce, and it succeeded. */
const didCall = (r: TransactionReceipt, to: Address) => r.status === "success" && !!r.to && isAddressEqual(r.to, to);

/**
 * Sign a stuck transaction again at its nonce with fees 15% over what it offered (or the market's,
 * if higher), as nodes require to replace it: the same call while it would still succeed, otherwise
 * a 0-value transfer to the keeper itself that just frees the nonce. Recorded before it is sent.
 * Null when it can't be: another key signed it, or it already offers far more than the market.
 */
async function bump(t: Tracked, replace?: Replace): Promise<Tracked | null> {
  if (!t.raw || t.nonce == null) return null;
  if (!isAddressEqual(await recoverTransactionAddress({ serializedTransaction: t.raw as never }), account.address)) return null;
  const old = parseTransaction(t.raw);
  const fees = await client.estimateFeesPerGas();
  if ((old.maxFeePerGas ?? 0n) > fees.maxFeePerGas * 20n) return null;
  const up = (was: bigint | undefined, now: bigint) => {
    const min = ((was ?? 0n) * 115n) / 100n + 1n;
    return min > now ? min : now;
  };
  const maxPriorityFeePerGas = up(old.maxPriorityFeePerGas, fees.maxPriorityFeePerGas);
  const maxFeePerGas = up(old.maxFeePerGas, fees.maxFeePerGas > maxPriorityFeePerGas ? fees.maxFeePerGas : maxPriorityFeePerGas);
  const same = !!old.to && (await client.call({ account: account.address, to: old.to, data: old.data, value: old.value }).then(() => true, () => false));
  const request = same ? { to: old.to!, data: old.data, value: old.value ?? 0n, gas: old.gas } : { to: account.address, value: 0n, gas: 21_000n };
  const raw = await wallet.signTransaction({ account, chain: base, type: "eip1559", nonce: t.nonce, maxFeePerGas, maxPriorityFeePerGas, ...request } as never);
  const hash = keccak256(raw);
  await replace?.(t.hashes[t.hashes.length - 1], { hash, nonce: t.nonce, raw });
  await client.sendRawTransaction({ serializedTransaction: raw }).catch((e) => log("re-send failed:", reason(e)));
  log("re-sent", t.hashes[t.hashes.length - 1], "as", hash, same ? "with higher fees" : "as a transfer to itself (the call no longer goes through)");
  return { hashes: [...t.hashes, hash], nonce: t.nonce, raw, signedAt: Date.now() };
}

/**
 * Simulate, sign, record, broadcast and wait for one call, in the send queue. Not mined within a
 * minute with its nonce still free: sent again with higher fees, and waited for once more. The
 * receipt is null when none came (the transaction stays recorded, for the next round).
 */
function transact(
  call: Call,
  record?: (hash: Hex, signed: Signed) => Promise<unknown>,
  replace?: Replace
): Promise<{ hash: Hex; receipt: TransactionReceipt | null }> {
  return serial(async () => {
    await client.simulateContract({ account, ...call } as never);
    let t = await broadcast(call, record);
    let receipt = await waitMined(t.hashes, BUMP_AFTER_MS);
    if (!receipt && (await client.getTransactionCount({ address: account.address, blockTag: "latest" })) <= t.nonce!) {
      const next = await bump(t, replace).catch((e) => (log("re-send failed:", reason(e)), null));
      if (next) t = next;
      receipt = await waitMined(t.hashes, BUMP_AFTER_MS);
    }
    return { hash: receipt?.transactionHash ?? t.hashes[t.hashes.length - 1], receipt };
  });
}

/** Rounds in which a tracked transaction's nonce was seen used with no receipt: the block it was first seen at. */
const usedSince = new Map<string, bigint>();

/**
 * "mined" (with its receipt); "dropped" only once its nonce is used, no receipt for any of its
 * hashes has shown up for some blocks (the node answering may lag the one that mined it), so it
 * can never land later; otherwise "pending": the stored signed transaction is sent again (the same
 * bytes: it can land at most once), or, a minute after it was signed, again with higher fees.
 * Without a stored nonce, an old record falls back to asking the node about the hash.
 */
async function txState(t: Tracked, replace?: Replace): Promise<{ state: "mined"; receipt: TransactionReceipt } | { state: "pending" } | { state: "dropped" }> {
  const receipt = await minedOf(t.hashes);
  if (receipt) return { state: "mined", receipt };
  const last = t.hashes[t.hashes.length - 1];
  if (t.nonce == null) return { state: (await client.getTransaction({ hash: last }).catch(() => null)) ? "pending" : "dropped" };
  const from = t.raw ? await recoverTransactionAddress({ serializedTransaction: t.raw as never }) : account.address;
  const used = await client.getTransactionCount({ address: from, blockTag: "latest" });
  if (used > t.nonce) {
    const head = await client.getBlockNumber();
    const first = usedSince.get(last) ?? head;
    usedSince.set(last, first);
    if (head - first < DROP_CONFIRM_BLOCKS) return { state: "pending" };
    usedSince.delete(last);
    return { state: "dropped" };
  }
  usedSince.delete(last);
  if (Date.now() - t.signedAt > BUMP_AFTER_MS) {
    const next = await serial(() => bump(t, replace)).catch((e) => (log("re-send failed:", reason(e)), null));
    if (next) return { state: "pending" };
  }
  if (t.raw) await client.sendRawTransaction({ serializedTransaction: t.raw }).catch(() => null);
  return { state: "pending" };
}

/**
 * A log from one of these transactions, looked for from about when the latest was signed: a
 * second look before a transaction whose receipt never showed is called dropped.
 */
async function loggedIn<T extends { transactionHash: Hex | null }>(t: Tracked, get: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>): Promise<T | null> {
  const hashes = new Set(t.hashes.map((h) => h.toLowerCase()));
  const head = await client.getBlockNumber();
  const back = BigInt(Math.ceil((Date.now() - t.signedAt) / 2_000)) + 50n; // Base: a block every 2 s
  let from = head > back ? head - back : 0n;
  for (let i = 0; i < 5 && from <= head; i++, from += SCAN_BLOCKS) {
    const to = from + SCAN_BLOCKS - 1n < head ? from + SCAN_BLOCKS - 1n : head;
    const hit = (await get(from, to)).find((l) => l.transactionHash && hashes.has(l.transactionHash.toLowerCase()));
    if (hit) return hit;
  }
  return null;
}

/** Each vault's Veranta TradingStorage (fixed at creation), and its looks in a row that showed no trade on Base. */
const storageOf = new Map<string, Address>();
const gone = new Map<string, { n: number; since: number; block: bigint }>();

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
  created_at: Date;
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
  const onBase = (functionName: "openTradesCount" | "pendingMarketOpenCount", blockNumber?: bigint) =>
    client.readContract({ address: storage!, abi: tradingStorageAbi, functionName, args: [vault, pair], blockNumber });
  const [idle, plan, paused, keeper, lastOpen, block, positions, priceRead, market, openTrades, pendingOpens, lastTopUp, owed] = await Promise.all([
    client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [vault] }),
    read<readonly [boolean, boolean, bigint, bigint, bigint]>("plans", [pair]),
    read<boolean>("paused"),
    read<Address>("keeper"),
    read<bigint>("lastOpenAt", [pair]),
    client.getBlock(),
    getPositions(row.address, { pairIndex: row.pair_index }),
    getSignedPrice(row.pair_index).catch((e: unknown) => e as Error),
    // Veranta no longer lists the pair: the vault is close-only, and an existing hedge is still tended.
    getMarket(row.pair_index).catch((e) => {
      if (e instanceof UnlistedMarketError) return null;
      throw e;
    }),
    onBase("openTradesCount"),
    onBase("pendingMarketOpenCount"),
    read<bigint>("lastTopUpAt", [pair]),
    read<bigint>("feeOwed", [pair]),
  ]);
  // A delisted pair may have no price feed either: no price, rather than a failing vault.
  if (priceRead instanceof Error && market) throw priceRead;
  const price = priceRead instanceof Error ? null : priceRead;
  let chainTrades = Number(openTrades) + Number(pendingOpens);
  // No trade on Base for a live hedge: read again at the block just seen, so each look that counts
  // towards closing it is at a later block than the last (one RPC node can be behind another).
  let counts = chainTrades === 0 && row.status === "active";
  if (counts) {
    try {
      const [o, p] = await Promise.all([onBase("openTradesCount", block.number), onBase("pendingMarketOpenCount", block.number)]);
      chainTrades = Number(o) + Number(p);
    } catch {
      counts = false;
    }
  }
  const prev = gone.get(row.address);
  if (chainTrades > 0 || row.status !== "active") gone.delete(row.address);
  else if (counts && (!prev || block.number > prev.block)) {
    gone.set(row.address, { n: (prev?.n ?? 0) + 1, since: prev?.since ?? Number(block.timestamp), block: block.number });
  }
  const look = chainTrades === 0 ? gone.get(row.address) : undefined;
  const cooldownEnds = Number(lastOpen) + 3600;
  // The hedge as Base holds it: the API can lag a top-up by a while, and sizing the next top-up from
  // its margin would send the same margin twice. Margin, leverage, price and size all from Base.
  let position = positions.find((p) => p.pairIndex === row.pair_index) ?? null;
  if (position && Number(openTrades) > 0) {
    const trade = await client.readContract({ address: storage, abi: tradingStorageAbi, functionName: "openTrades", args: [vault, pair, BigInt(position.index)] });
    position = withChainTrade(position, trade);
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
    marketOpen: (market ? market.marketOpen : true) && !!price,
    closeOnly: !market || market.closeOnly || !market.listed,
    terms: openTerms(market, row.sizing.buy),
    paused,
    keeperIsUs: keeper.toLowerCase() === account.address.toLowerCase() && !keeperRevoked,
    cooldownLeftS: Math.max(0, cooldownEnds - Number(block.timestamp)),
    openSentAgoS: row.open_sent_at ? (Date.now() - row.open_sent_at.getTime()) / 1000 : null,
    chainTrades,
    goneRounds: look?.n ?? 0,
    goneForS: look ? Number(block.timestamp) - look.since : 0,
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
  // Simulated first: a revert costs nothing and says why. Only then recorded as being sent.
  const { hash, receipt } = await transact({ address: vault, abi: vaultAbi as Abi, functionName, args, value }, beforeSend);
  if (!receipt) throw new Error(`${functionName} isn't mined yet (${hash})`);
  if (receipt.status !== "success") throw new Error(`${functionName} reverted in ${hash}`);
  // Replaced by the transfer that freed its nonce: it never ran; the next round decides again.
  if (!didCall(receipt, vault)) throw new Error(`${functionName} no longer went through; its transaction was replaced (${hash})`);
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

/** When each vault waiting for its deposit is next looked at. */
const nextLook = new Map<string, number>();
const DORMANT_NOTE = "No deposit arrived within a week, so Locke has set this vault aside. Deposit what the hedge needs and Locke picks it up again.";

/**
 * A vault still waiting for its deposit is looked at every few minutes with one balance read, not
 * every round in full; still short a week after it was created, it is set aside (dormant_at) until
 * a deposit is seen. True when that was all there was to do.
 */
async function awaitingDeposit(row: Row): Promise<boolean> {
  if (row.status !== "funding" || row.open_sent_at) return false;
  const idle = fromUsdcUnits(await client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(row.address)] }));
  const need = depositNeededUsd(row.sizing);
  if (idle + 1e-9 >= need) {
    nextLook.delete(row.address);
    return false;
  }
  nextLook.set(row.address, Date.now() + FUNDING_LOOK_MS);
  if (Date.now() - new Date(row.created_at).getTime() > DORMANT_AFTER_MS) {
    await db()`update base_vaults set dormant_at = now(), status_note = ${DORMANT_NOTE}, updated_at = now() where address = ${row.address} and status = 'funding' and dormant_at is null`;
    nextLook.delete(row.address);
    log("vault", row.address, "has waited a week for its deposit; set aside until it is funded");
    return true;
  }
  const text = `Waiting for the deposit: the vault holds $${idle.toFixed(2)} of the $${need.toFixed(2)} the hedge needs.`;
  if (row.status_note !== text) await note(row.address, text);
  return true;
}

/** Vaults set aside for want of a deposit, checked a batch at a time, the longest unchecked first: funded ones are tended again. */
async function sweepDormant() {
  const rows = await db()`select address, sizing from base_vaults where dormant_at is not null and status = 'funding' order by updated_at limit 500`;
  const idle = await Promise.all(
    rows.map((r) => client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(r.address as string)] }).catch(() => null))
  );
  const checked = rows.filter((r, i) => idle[i] != null);
  const funded = checked.filter((r) => fromUsdcUnits(idle[rows.indexOf(r)]!) + 1e-9 >= depositNeededUsd(r.sizing as BaseSizing)).map((r) => r.address as string);
  if (funded.length) await db()`update base_vaults set dormant_at = null, status_note = null, updated_at = now() where address in ${db()(funded)}`;
  if (checked.length) await db()`update base_vaults set updated_at = now() where address in ${db()(checked.map((r) => r.address as string))} and dormant_at is not null`;
  if (funded.length) log("deposits arrived in", funded.length, "vaults set aside; tending them again");
}

async function tend(row: Row) {
  if (await awaitingDeposit(row)) return;
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
  if (d.status === "active") await attest(row, state.position).catch((e) => log("attest", row.address, "failed:", reason(e)));
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
  // Every one still open, so a replaced one that landed after all is recorded, never issued twice.
  const pending = await db()`
    select e.detail->>'attestTx' as tx, e.detail->'prev' as prev, e.detail->>'nonce' as nonce, e.detail->>'raw' as raw, e.detail->>'signedAt' as signed_at, e.created_at
    from base_vault_events e
    where e.vault = ${address} and e.detail ? 'attestTx'
      and not exists (select 1 from base_vault_events r where r.vault = e.vault and r.detail->>'tx' = e.detail->>'attestTx')
    order by e.id desc`;
  let open = false;
  for (const p of pending) if (await resolveAttestTx(address, p)) open = true;
  return open;
}

const ATTESTED = parseAbiItem("event Attested(address indexed recipient, address indexed attester, bytes32 uid, bytes32 indexed schemaUID)");

async function resolveAttestTx(address: string, p: Record<string, unknown>): Promise<boolean> {
  const hash = p.tx as Hex;
  const t: Tracked = {
    hashes: [...((p.prev as Hex[] | null) ?? []), hash],
    nonce: p.nonce == null ? undefined : Number(p.nonce),
    raw: (p.raw as Hex | null) ?? undefined,
    signedAt: p.signed_at ? Number(p.signed_at) : new Date(p.created_at as string).getTime(),
  };
  const published = (uid: Hex, mined: Hex) =>
    addVaultEvent(address, "info", "Protected by Locke: proof published on Base", { attestation: uid, tx: hash }, mined);
  const lost = () => addVaultEvent(address, "info", "The proof didn't publish; Locke tries again", { tx: hash, failed: true }, hash);
  let receipt = await minedOf(t.hashes);
  if (!receipt) {
    // Not mined: still waiting (sent again, with higher fees if need be), unless it can no longer
    // land. Then it is closed off so a new one can be issued.
    const old = Date.now() - new Date(p.created_at as string).getTime() > DROPPED_AFTER_MS;
    if (!old && t.nonce == null) return true;
    const s = await txState(t, (prev, next) => replaceAttestTx(address, prev, next));
    if (s.state === "pending") return true;
    if (s.state === "dropped") {
      // A last look for the attestation itself before it is called lost.
      const attester = t.raw ? await recoverTransactionAddress({ serializedTransaction: t.raw as never }) : account.address;
      const args = { attester, schemaUID: PROTECTION_SCHEMA_UID };
      const ev = await loggedIn(t, (fromBlock, toBlock) => client.getLogs({ address: EAS_ADDRESS, event: ATTESTED, args, fromBlock, toBlock }));
      if (ev?.args.uid && ev.transactionHash) await published(ev.args.uid, ev.transactionHash);
      else await lost();
      return false;
    }
    receipt = s.receipt;
  }
  const [ev] = receipt.status === "success" ? parseEventLogs({ abi: easAbi, logs: receipt.logs, eventName: "Attested" }) : [];
  if (ev) await published(ev.args.uid, receipt.transactionHash);
  else await lost();
  return false;
}

/** The pending proof now goes by its replacement's hash; the earlier ones are kept, as any of them may land. */
async function replaceAttestTx(address: string, prev: Hex, next: Signed & { hash: Hex }) {
  await db()`
    update base_vault_events set tx_hash = ${next.hash},
      detail = detail || jsonb_build_object('attestTx', ${next.hash}::text, 'raw', ${next.raw}::text, 'signedAt', ${Date.now()}::bigint,
                                            'prev', coalesce(detail->'prev', '[]'::jsonb) || to_jsonb(${prev}::text))
    where vault = ${address} and detail->>'attestTx' = ${prev}`;
}

/** Issue the vault's "Protected by Locke" attestation to its owner, unless it already has one. */
async function attest(row: Row, position: VaultState["position"]) {
  if (await resolvePendingAttestation(row.address)) return;
  if (await activeAttestation(row.address)) return;
  if (!schemaReady) await ensureSchema();
  const vault = getAddress(row.address);
  const owner = (await client.readContract({ address: vault, abi: vaultAbi, functionName: "owner" })) as Address;
  const request = protectionRequest(owner, {
    vault,
    market: baseMarket(row.pair_index)?.symbol ?? String(row.pair_index),
    long: row.sizing.buy,
    // The hedge's size as Base holds it; the plan's while the API hasn't reported the trade yet.
    protectedUsd: position ? Math.round(position.collateralUsd * position.leverage * 100) / 100 : row.sizing.notionalUsd,
    startedAt: Math.floor((row.opened_at ?? new Date()).getTime() / 1000),
  });
  // Recorded before it is broadcast, so a timeout or restart resolves this transaction instead of sending another.
  const { hash } = await transact(
    { address: EAS_ADDRESS, abi: easAbi as Abi, functionName: "attest", args: [request] },
    (h, s) =>
      addVaultEvent(row.address, "info", "Publishing the Protected by Locke proof on Base", { attestTx: h, nonce: s.nonce, raw: s.raw, signedAt: Date.now() }, h),
    (prev, next) => replaceAttestTx(row.address, prev, next)
  );
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
    if (stopping) return;
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
      // EAS lets only the attester revoke: one issued by an earlier keeper key can't be. It leaves
      // the queue, recorded as such; the proof page shows it as ended since the vault is closed.
      if (!isAddressEqual(current.attester, account.address)) {
        log("revoke", address, uid, "was issued by an earlier keeper key", current.attester, "and can't be revoked by this one");
        await addVaultEvent(address, "info", "Vault closed: its proof was issued by an earlier Locke keeper key, so it can't be revoked on Base; the proof page shows it as ended", {
          revoked: uid,
          unrevokable: true,
          attester: current.attester.toLowerCase(),
        });
        continue;
      }
      const args = [{ schema: PROTECTION_SCHEMA_UID, data: { uid: uid as Hex, value: 0n } }] as const;
      const { hash, receipt } = await transact({ address: EAS_ADDRESS, abi: easAbi as Abi, functionName: "revoke", args });
      if (!receipt) throw new Error(`revoke isn't mined yet (${hash})`);
      if (!didCall(receipt, EAS_ADDRESS)) throw new Error(`revoke reverted or was replaced in ${hash}`);
      log("revoked", address, uid, hash);
      await addVaultEvent(address, "info", "Vault closed: the Protected by Locke proof is revoked", { revoked: uid }, hash);
    } catch (e) {
      log("revoke", address, "failed:", reason(e));
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
  inflight_prev: Hex[] | null;
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
             i.inflight_tx, i.inflight_usd, i.inflight_at, i.inflight_nonce, i.inflight_raw, i.inflight_prev
      from base_income i join base_vaults v on v.address = i.vault where i.status = 'on' order by i.created_at`) as unknown as IncomeRow[];
  } catch (e) {
    if ((e as { code?: string }).code === "42P01") return; // not migrated yet
    throw e;
  }
  if (rows.length === 0) return;
  const latest = await client.getBlockNumber();
  // Each vault would take its share of the same incoming USDC: only an owner's first vault with it on
  // collects (turning it on for a second one is refused; this covers any from before that check).
  const accounts = new Set<string>();
  for (const r of rows) {
    if (stopping) return;
    try {
      const who = String(r.permission.account).toLowerCase();
      if (r.vault_status !== "closed") {
        if (accounts.has(who) && !r.inflight_tx) {
          await db()`update base_income set status = 'off', updated_at = now() where vault = ${r.vault}`;
          await addVaultEvent(r.vault, "info", "Protect as you get paid is on for another of your vaults, which takes the share: it is off here");
          continue;
        }
        accounts.add(who);
      }
      await tendIncome(r, latest);
    } catch (e) {
      log("income", r.vault, "failed:", reason(e));
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
    const t: Tracked = {
      hashes: [...(r.inflight_prev ?? []), r.inflight_tx],
      nonce: r.inflight_nonce == null ? undefined : Number(r.inflight_nonce),
      raw: r.inflight_raw ?? undefined,
      signedAt: r.inflight_at ? new Date(r.inflight_at).getTime() : 0,
    };
    const booked = await bookCollection(r.vault, r.inflight_tx, t, Number(r.inflight_usd));
    // Forgotten only once it can no longer land: one still in a mempool can.
    const old = r.inflight_at && Date.now() - new Date(r.inflight_at).getTime() > INFLIGHT_DROPPED_MS;
    if (booked === "waiting" && (old || t.nonce != null) && (await txState(t, (prev, next) => replaceCollection(r.vault, prev, next))).state === "dropped") {
      // A last look for the USDC it moved before it is called dropped.
      const args = { from: p.account, to: vault };
      const moved = await loggedIn(t, (fromBlock, toBlock) => client.getLogs({ address: USDC, event: USDC_TRANSFER, args, fromBlock, toBlock }));
      if (moved?.transactionHash) return void (await book(r.vault, r.inflight_tx, moved.transactionHash, Number(r.inflight_usd)));
      await sql`update base_income set inflight_tx = null, inflight_usd = null, inflight_at = null, inflight_nonce = null, inflight_raw = null, inflight_prev = null
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
  // Marked before it is broadcast: a timeout or restart books this transaction next round instead of sending another.
  const { hash } = await transact(
    { address: vault, abi: collectIncomeAbi as Abi, functionName: "collectIncome", args },
    (h, s) => sql`update base_income set inflight_tx = ${h}, inflight_usd = ${amount}, inflight_at = now(), inflight_nonce = ${s.nonce}, inflight_raw = ${s.raw}, inflight_prev = null
                  where vault = ${r.vault}`,
    (prev, next) => replaceCollection(r.vault, prev, next)
  );
  const [now] = await sql`select inflight_tx, inflight_prev from base_income where vault = ${r.vault}`;
  const hashes: Hex[] = now?.inflight_tx ? [...(now.inflight_prev ?? []), now.inflight_tx] : [];
  if (now?.inflight_tx) await bookCollection(r.vault, now.inflight_tx, { hashes, signedAt: Date.now() }, amount);
  else log("income", r.vault, "collection", hash, "is no longer in flight");
}

/** The collection in flight now goes by its replacement's hash; the earlier ones are kept, as any of them may land. */
async function replaceCollection(vaultAddr: string, prev: Hex, next: Signed & { hash: Hex }) {
  await db()`update base_income set inflight_tx = ${next.hash}, inflight_raw = ${next.raw}, inflight_at = now(),
               inflight_prev = array_append(coalesce(inflight_prev, '{}'), ${prev}::text)
             where vault = ${vaultAddr} and inflight_tx = ${prev}`;
}

const clearInflight = (vaultAddr: string, current: Hex) =>
  db()`update base_income set inflight_tx = null, inflight_usd = null, inflight_at = null, inflight_nonce = null, inflight_raw = null, inflight_prev = null
       where vault = ${vaultAddr} and inflight_tx = ${current}`;

/**
 * Book a sent collection (in flight as `current`) from the receipt of whichever of its hashes was
 * mined, once. "waiting" while none has a receipt yet.
 */
async function bookCollection(vaultAddr: string, current: Hex, t: Tracked, amount: number): Promise<"booked" | "failed" | "waiting"> {
  const receipt = await minedOf(t.hashes);
  if (!receipt) return "waiting";
  // Reverted, or replaced by the transfer that freed its nonce: nothing moved.
  if (!didCall(receipt, getAddress(vaultAddr))) {
    await clearInflight(vaultAddr, current);
    log("income", vaultAddr, "collection reverted or replaced:", receipt.transactionHash);
    return "failed";
  }
  await book(vaultAddr, current, receipt.transactionHash, amount);
  return "booked";
}

async function book(vaultAddr: string, current: Hex, mined: Hex, amount: number) {
  const [row] = await db()`
    update base_income set pending_usd = greatest(pending_usd - ${amount}, 0), collected_usd = collected_usd + ${amount},
      last_collected_at = now(), inflight_tx = null, inflight_usd = null, inflight_at = null, inflight_nonce = null, inflight_raw = null, inflight_prev = null,
      updated_at = now()
    where vault = ${vaultAddr} and inflight_tx = ${current} returning vault`;
  if (row) {
    log("collected income", vaultAddr, amount, mined);
    await addVaultEvent(vaultAddr, "info", `Moved $${amount.toFixed(2)} of incoming USDC into the vault`, undefined, mined);
  }
}

/** EAS assigns the schema its id from its text; register it the first time any keeper runs. */
async function ensureSchema() {
  const known = await client.readContract({ address: SCHEMA_REGISTRY_ADDRESS, abi: schemaRegistryAbi, functionName: "getSchema", args: [PROTECTION_SCHEMA_UID] });
  if (known.uid === PROTECTION_SCHEMA_UID) {
    schemaReady = true;
    return;
  }
  const args = [PROTECTION_SCHEMA, zeroAddress, true] as const;
  const { hash, receipt } = await transact({ address: SCHEMA_REGISTRY_ADDRESS, abi: schemaRegistryAbi as Abi, functionName: "register", args });
  if (!receipt || !didCall(receipt, SCHEMA_REGISTRY_ADDRESS)) throw new Error(`schema registration isn't mined yet, or failed (${hash})`);
  schemaReady = true;
  log("registered the Protected by Locke schema", PROTECTION_SCHEMA_UID, hash);
}

/** Vaults failing this many rounds in a row (about two minutes) make the keeper unhealthy. */
const UNHEALTHY_AFTER = 8;

let lastSweep = 0;

async function loop() {
  // Live hedges first, the most at risk first: a slow vault mustn't delay a margin top-up. Vaults
  // set aside for want of a deposit aren't read until one arrives (sweepDormant).
  const rows = (await db()`
    select address, pair_index, status, sizing, risk_level, status_note, open_sent_at, opened_at, topup_sent_at, topup_from_usd, created_at
    from base_vaults where status <> 'closed' and dormant_at is null
    order by case status when 'active' then 0 else 1 end, last_ratio desc nulls last, created_at`) as unknown as Row[];
  const problems: string[] = [];
  // Revoked for every vault by Locke's guardian: say so on each vault instead of failing every round.
  keeperRevoked = await client
    .readContract({ address: config.baseFactoryAddress!, abi: factoryAbi, functionName: "keeperRevoked", args: [account.address] })
    .catch(() => keeperRevoked);
  // Vaults no longer tended (closed, or gone) drop out of the failure count and the other per-vault state.
  const live = new Set(rows.map((r) => r.address));
  for (const m of [failures, nextLook, gone, storageOf] as Map<string, unknown>[]) for (const k of m.keys()) if (!live.has(k)) m.delete(k);
  // Several vaults are read and decided at once; their transactions still go out one at a time.
  const due = rows.filter((r) => (nextLook.get(r.address) ?? 0) <= Date.now());
  let next = 0;
  const worker = async () => {
    while (!stopping && next < due.length) {
      const row = due[next++];
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
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker));
  // Each of these failing is logged and reported, but never stops the heartbeat below.
  if (!stopping) await revokeClosed().catch((e) => problems.push(`revoke: ${reason(e)}`));
  if (!stopping) await collectIncome().catch((e) => problems.push(`income: ${reason(e)}`));
  if (!stopping && Date.now() - lastSweep > DORMANT_SWEEP_MS) {
    lastSweep = Date.now();
    await sweepDormant().catch((e) => problems.push(`dormant vaults: ${reason(e)}`));
  }
  await client
    .getBalance({ address: account.address })
    .then((gas) => {
      gasLow = gas < MIN_GAS_ETH;
      if (gas < WARN_GAS_ETH) {
        log(`keeper ${account.address} is low on ETH: ${formatEther(gas)}`);
        if (!gasLow) problems.push(`gas: the keeper has ${formatEther(gas)} ETH; top it up before it reaches ${formatEther(MIN_GAS_ETH)}`);
      }
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
      log("loop failed:", reason(e));
    }
    if (stopping) {
      log("stopped");
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, LOOP_MS));
  }
}

main().catch((e) => {
  // Never the error object itself: a viem error quotes the RPC URL, which can carry its key.
  log("stopped:", reason(e));
  process.exit(1);
});
