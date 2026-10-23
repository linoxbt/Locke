// Plan lifecycle: draft → funding → opening → active → closing → closed.
// Used by the API routes and by the risk worker, so it must not import Next.js modules.
//
// Rules (spec section 12):
// - The server recomputes every order from the stored plan; sizes from the browser are never trusted.
// - Status changes are compare-and-set, so two callers (browser and worker) can't both act.
// - Orders are tracked: at most one in flight per plan, with a deterministic client id
//   locke-{planId}-{action}-{n}. When the outcome of a send is unclear (timeout, 5xx), Locke never
//   re-sends: it asks Strike about that exact id and settles the plan from the order's real status.
// - Margin adds are verified against the position's isolated balance before they're retried, so a
//   lost response can't add margin twice or drop a top-up.
// - Money credited for one plan is reserved for it: other plans can't spend it.

import {
  buildPreview,
  liveHeadline,
  parseInputs,
  PLAN_LABEL,
  PLAN_MARKET,
  PlanInputError,
  sizePlan,
} from "../domain/plans";
import {
  combinedLevel,
  DEMO_THRESHOLDS,
  DISTANCE_LEVELS,
  distanceToLiquidation,
  fundingPerDay,
  isoForLiquidationAt,
  liquidationPrice,
  LOCKE_THRESHOLDS,
  maintenanceMargin,
  marginRatio,
  priceAtDistance,
  priceAtRatio,
  suggestedTopUpUsd,
  type Thresholds,
} from "../domain/risk";
import { FUELS } from "../domain/fuel";
import { estimateFill, fillProblem, type FillEstimate } from "../domain/liquidity";
import type { CostsInputs, HoldingsInputs, PlanInputs, PlanStatus, PlanType, Preview, RiskLevel, Side, Sizing } from "../domain/types";
import {
  addIsolatedMargin,
  depositBuildTx,
  depositConfirm,
  depositQuote,
  getAccount,
  getDepositHistory,
  getFeeRates,
  getMarketRules,
  getMarkPrice,
  getOrderBook,
  getOrderByClientId,
  getPosition,
  getSymbolSetting,
  placeMarketOrder,
  setLeverage,
  setMarginMode,
  StrikeError,
  type ApiKeys,
  type StrikePosition,
} from "../strike/client";
import { config } from "./config";
import { db } from "./db";
import { HttpError } from "./errors";
import { strikeKeysFor } from "./keys";

/** Strike's minimum is $5; a dollar more absorbs ADA moving while the user signs. */
export const MIN_DEPOSIT_USD = 6;
/** Deposited ADA is converted to USD on the way in; this covers conversion and price drift. */
const DEPOSIT_CUSHION = 1.03;
/** A sent order Strike still doesn't know about after this long was never accepted. */
const ORDER_LOOKUP_GRACE_MS = 2 * 60_000;
/** A live plan's position must be missing this long (two reads apart) before the plan is closed. */
const MISSING_GRACE_MS = 60_000;
/** How often a plan stuck in closing re-sends its reduce-only close. */
const CLOSE_RETRY_MS = 30_000;
/** The worker stops auto-opening a plan after this many orders; the user can still open by hand. */
const AUTO_OPEN_ATTEMPTS = 3;
/** Deposits that never move on expire: built but unsigned, and submitted but never seen by Strike. */
const BUILT_TTL_MS = 2 * 3600_000;
const SUBMITTED_TTL_MS = 6 * 3600_000;

type OrderAction = "open" | "close" | "resize";

export interface PlanRow {
  id: string;
  user_id: string;
  type: PlanType;
  name: string;
  symbol: string;
  side: "buy" | "sell";
  status: PlanStatus;
  inputs: PlanInputs;
  sizing: Sizing;
  size: number;
  entry_price: number | null;
  buffer_added: boolean;
  risk_level: RiskLevel;
  last_ratio: number | null;
  status_note: string | null;
  order_seq: number;
  pending_order: string | null;
  pending_action: OrderAction | null;
  pending_meta: { inputs?: PlanInputs; target?: number; name?: string; from?: number } | null;
  pending_since: Date | null;
  missing_since: Date | null;
  risk_ack_at: Date | null;
  opened_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function thresholds(): Thresholds {
  return config.demoAlerts ? DEMO_THRESHOLDS : LOCKE_THRESHOLDS;
}

export async function addEvent(planId: string, level: string, message: string, detail?: object) {
  await db()`insert into plan_events (plan_id, level, message, detail)
             values (${planId}, ${level}, ${message}, ${detail ? db().json(detail as never) : null})`;
}

/** An event that must never undo the step it reports (it runs after Strike already acted). */
async function safeEvent(planId: string, level: string, message: string, detail?: object) {
  try {
    await addEvent(planId, level, message, detail);
  } catch (e) {
    console.error("[event]", planId, e instanceof Error ? e.message : e);
  }
}

/** Show why a plan is waiting, once: syncs repeat, so the same note doesn't log a new event each time. */
async function noteOnce(plan: PlanRow, note: string, level: "watch" | "action" = "watch") {
  if (plan.status_note === note) return;
  plan.status_note = note;
  await db()`update plans set status_note = ${note}, updated_at = now() where id = ${plan.id}`;
  await safeEvent(plan.id, level, note);
}

export async function loadPlan(userId: string, planId: string): Promise<PlanRow> {
  if (!/^[0-9a-f-]{36}$/i.test(planId)) throw new HttpError(404, "Plan not found");
  const [row] = await db()`select * from plans where id = ${planId} and user_id = ${userId}`;
  if (!row) throw new HttpError(404, "Plan not found");
  return row as unknown as PlanRow;
}

/** Compare-and-set status change. Returns the updated row, or null if another caller won. */
async function transition(
  planId: string,
  from: PlanStatus[],
  to: PlanStatus,
  extra: Partial<Pick<PlanRow, "status_note" | "entry_price">> & { opened?: boolean; closed?: boolean; size?: number } = {}
): Promise<PlanRow | null> {
  const [row] = await db()`
    update plans set
      status = ${to},
      status_note = ${extra.status_note ?? null},
      entry_price = coalesce(${extra.entry_price ?? null}, entry_price),
      size = coalesce(${extra.size ?? null}, size),
      opened_at = case when ${!!extra.opened} then now() else opened_at end,
      closed_at = case when ${!!extra.closed} then now() else closed_at end,
      missing_since = null,
      updated_at = now()
    where id = ${planId} and status in ${db()(from)}
    returning *`;
  return (row as unknown as PlanRow) ?? null;
}

function planName(type: PlanType, inputs: PlanInputs): string {
  if (type === "holdings") {
    const h = inputs as HoldingsInputs;
    return `ADA treasury · ${h.sharePct}% protected`;
  }
  const c = inputs as CostsInputs;
  const cover = (c.coverPct ?? 100) < 100 ? ` · ${c.coverPct}% hedged` : "";
  return `${FUELS[c.fuelType]?.short ?? "Fuel"} · ${c.litresPerMonth.toLocaleString("en-US")} L/month · ${c.months} mo${cover}`;
}

/** Market fill estimate for the hedge order; undefined if Strike's book can't be read right now. */
async function executionFor(sizing: Sizing): Promise<FillEstimate | undefined> {
  const book = await getOrderBook(sizing.symbol).catch(() => null);
  return book ? estimateFill(book, sizing.side, sizing.size, sizing.price) : undefined;
}

/** Strike's book can't take the order at a fair price right now. Nothing was sent; safe to retry later. */
export class ThinBookError extends HttpError {
  constructor(message: string) {
    super(409, message);
  }
}

/** Refuse to send a market order the visible book can't fill at a fair price. Reads a fresh book. */
async function assertFillable(symbol: string, side: Side, size: number) {
  const [book, mark] = await Promise.all([getOrderBook(symbol, { fresh: true }), getMarkPrice(symbol)]);
  const problem = fillProblem(estimateFill(book, side, size, mark.mark));
  if (problem) throw new ThinBookError(problem);
}

async function sizeAtMarket(type: PlanType, inputs: PlanInputs) {
  const symbol = PLAN_MARKET[type];
  const [mark, rules, fees] = await Promise.all([getMarkPrice(symbol), getMarketRules(symbol), getFeeRates()]);
  const sizing = sizePlan(type, inputs, mark.mark, rules, fees);
  return { mark, rules, sizing };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Balance, reserved per plan ──

async function availableUsd(keys: ApiKeys): Promise<number> {
  const acct = await getAccount(keys);
  return parseFloat(acct.available_balance ?? "0") || 0;
}

/** USD credited on Strike for the user's other plans and not yet applied: this plan can't spend it. */
async function reservedForOthers(userId: string, planId: string): Promise<number> {
  const [r] = await db()`
    select coalesce(sum(usd_value), 0)::float8 as usd from deposits
    where user_id = ${userId} and status = 'credited' and plan_id is distinct from ${planId}`;
  return Number(r.usd) || 0;
}

/** Free balance this plan may use: Strike's available balance minus other plans' reservations. */
async function spendableUsd(keys: ApiKeys, userId: string, planId: string): Promise<number> {
  const [available, reserved] = await Promise.all([availableUsd(keys), reservedForOthers(userId, planId)]);
  return Math.max(0, available - reserved);
}

/**
 * Add isolated margin and confirm it landed. If the call fails, the position is read again: if the
 * isolated balance grew by the amount, it did land (the response was lost). Returns false only
 * when the margin is not there, so the caller can safely retry later.
 */
async function addMarginVerified(keys: ApiKeys, plan: PlanRow, amount: number, before: StrikePosition): Promise<boolean> {
  try {
    await addIsolatedMargin(keys, plan.symbol, amount);
    return true;
  } catch (e) {
    const after = await getPosition(keys, plan.symbol).catch(() => null);
    const grew = after ? parseFloat(after.iso_balance) - parseFloat(before.iso_balance) : 0;
    if (grew >= amount * 0.9) return true;
    console.error("[margin]", plan.id, e instanceof Error ? e.message : e);
    return false;
  }
}

// ── Tracked orders ──

/** Reserve the plan's single order slot. Returns the client id, or null if an order is already in flight. */
async function claimOrder(planId: string, action: OrderAction, meta: PlanRow["pending_meta"] = null): Promise<string | null> {
  const [row] = await db()`
    update plans set
      order_seq = order_seq + 1,
      pending_order = 'locke-' || id::text || '-' || ${action} || '-' || (order_seq + 1)::text,
      pending_action = ${action},
      pending_meta = ${meta ? db().json(meta as never) : null},
      pending_since = now(),
      updated_at = now()
    where id = ${planId} and pending_order is null
    returning pending_order`;
  return (row?.pending_order as string) ?? null;
}

async function clearOrder(planId: string, clientId: string) {
  await db()`update plans set pending_order = null, pending_action = null, pending_meta = null, pending_since = null, updated_at = now()
             where id = ${planId} and pending_order = ${clientId}`;
}

/**
 * Send a claimed market order. Throws only when Strike certainly refused it (a 4xx before
 * accepting), after freeing the slot. Any other failure leaves the order pending: Strike may
 * have taken it, and resolvePending() will find out from the order's real status.
 */
async function sendClaimedOrder(
  keys: ApiKeys,
  plan: PlanRow,
  clientId: string,
  o: { side: Side; size: number; reduceOnly?: boolean }
): Promise<void> {
  try {
    await placeMarketOrder(keys, { symbol: plan.symbol, side: o.side, size: String(o.size), clientOrderId: clientId, reduceOnly: o.reduceOnly });
  } catch (e) {
    if (e instanceof StrikeError && e.status >= 400 && e.status < 500) {
      await clearOrder(plan.id, clientId);
      throw e;
    }
    console.error("[order] unclear outcome, will check with Strike", clientId, e instanceof Error ? e.message : e);
  }
}

type OrderOutcome = "working" | "filled" | "partial" | "failed";

/** What happened to the plan's pending order, from Strike. Null while it's too early to tell. */
async function pendingOutcome(keys: ApiKeys, plan: PlanRow): Promise<{ outcome: OrderOutcome; reason: string } | null> {
  if (!plan.pending_order) return null;
  const age = Date.now() - new Date(plan.pending_since ?? plan.updated_at).getTime();
  const o = await getOrderByClientId(keys, plan.symbol, plan.pending_order);
  if (!o) return age < ORDER_LOOKUP_GRACE_MS ? null : { outcome: "failed", reason: "Strike never received the order" };
  if (o.Status === "pending" || o.Status === "open" || o.Status === "untriggered") return { outcome: "working", reason: "" };
  if (o.Status === "filled") return { outcome: "filled", reason: "" };
  const filled = parseFloat(o.Filled) || 0;
  const reason = `Strike ${o.Status} the order${o.CloseReason ? ` (${o.CloseReason})` : ""}`;
  return { outcome: filled > 0 ? "partial" : "failed", reason };
}

/** Activate an opening plan from its position, and consume the deposits that funded it. */
async function activate(plan: PlanRow, pos: StrikePosition): Promise<PlanRow | null> {
  const entry = parseFloat(pos.entry_price);
  const size = Math.abs(parseFloat(pos.size));
  const won = await transition(plan.id, ["opening"], "active", { entry_price: entry, opened: true, size, status_note: null });
  if (!won) return null;
  await db()`update deposits set status = 'applied', applied_usd = usd_value, updated_at = now()
             where plan_id = ${plan.id} and purpose = 'open' and status = 'credited'`;
  await safeEvent(plan.id, "info", `Hedge open on Strike: ${size} ${plan.symbol} at ${entry}`, { size: pos.size });
  return won;
}

/** Settle the plan's pending order from Strike's answer. */
async function resolvePending(keys: ApiKeys, plan: PlanRow, pos: StrikePosition | null): Promise<PlanRow> {
  const r = await pendingOutcome(keys, plan).catch(() => null);
  if (!r || r.outcome === "working") return plan;
  const clientId = plan.pending_order!;
  const action = plan.pending_action;

  if (action === "open") {
    if (r.outcome === "filled" || r.outcome === "partial") {
      // The position can trail the fill by a moment; wait for it rather than guess, but not forever:
      // after 5 minutes the slot is freed and syncPlan's opening timeout decides.
      if (!pos) {
        const age = Date.now() - new Date(plan.pending_since ?? plan.updated_at).getTime();
        if (age < 5 * 60_000) return plan;
        await clearOrder(plan.id, clientId);
        return loadPlanById(plan.id);
      }
      await clearOrder(plan.id, clientId);
      const won = await activate({ ...plan, pending_order: null }, pos);
      if (r.outcome === "partial") await safeEvent(plan.id, "watch", `The hedge filled partly: ${Math.abs(parseFloat(pos.size))} of ${plan.size}.`);
      return won ?? loadPlanById(plan.id);
    }
    await clearOrder(plan.id, clientId);
    const note = `${r.reason}. Your funds stay on Strike; open again to retry.`;
    const won = await transition(plan.id, ["opening"], "funding", { status_note: note });
    if (won) await safeEvent(plan.id, "action", note);
    return won ?? loadPlanById(plan.id);
  }

  if (action === "close") {
    await clearOrder(plan.id, clientId);
    if (r.outcome !== "filled") await safeEvent(plan.id, "watch", `${r.reason}. Locke will try the close again.`);
    return loadPlanById(plan.id); // syncPlan finishes the close (or re-sends it) from the position
  }

  // resize
  const meta = plan.pending_meta ?? {};
  await clearOrder(plan.id, clientId);
  if (r.outcome === "filled" && meta.inputs && meta.target != null) {
    await db()`update plans set inputs = ${db().json(meta.inputs as never)}, size = ${meta.target}, name = ${meta.name ?? plan.name},
               updated_at = now() where id = ${plan.id}`;
    await safeEvent(plan.id, "info", `Hedge resized from ${meta.from} to ${meta.target}`);
  } else if (r.outcome === "partial" && pos) {
    await db()`update plans set size = ${Math.abs(parseFloat(pos.size))}, updated_at = now() where id = ${plan.id}`;
    await safeEvent(plan.id, "watch", `The resize filled partly; the hedge is now ${Math.abs(parseFloat(pos.size))}.`);
  } else {
    await safeEvent(plan.id, "action", `The resize didn't go through: ${r.reason}.`);
  }
  return loadPlanById(plan.id);
}

async function loadPlanById(planId: string): Promise<PlanRow> {
  const [row] = await db()`select * from plans where id = ${planId}`;
  return row as unknown as PlanRow;
}

/** After sending, give Strike a few seconds to settle the order so the user sees the result at once. */
async function settleSoon(keys: ApiKeys, planId: string): Promise<PlanRow> {
  let plan = await loadPlanById(planId);
  for (let i = 0; i < 4 && plan.pending_order; i++) {
    await sleep(800);
    const pos = await getPosition(keys, plan.symbol).catch(() => null);
    plan = await resolvePending(keys, plan, pos);
  }
  return plan;
}

// ── Draft and preview ──

export async function createDraft(userId: string, type: PlanType, raw: Record<string, unknown>) {
  if (type !== "holdings" && type !== "costs") throw new PlanInputError("Unknown plan type");
  const inputs = parseInputs(type, raw);
  const { mark, rules, sizing } = await sizeAtMarket(type, inputs);
  const preview = buildPreview(type, inputs, sizing, rules, mark.fundingRate);
  preview.execution = await executionFor(sizing);
  const sql = db();
  await sql`delete from plans where user_id = ${userId} and type = ${type} and status = 'draft'`;
  const [row] = await sql`
    insert into plans (user_id, type, name, symbol, side, inputs, sizing, size)
    values (${userId}, ${type}, ${planName(type, inputs)}, ${sizing.symbol}, ${sizing.side},
            ${sql.json(inputs as never)}, ${sql.json(sizing as never)}, ${sizing.size})
    returning *`;
  return { plan: row as unknown as PlanRow, preview };
}

export async function previewFor(plan: PlanRow): Promise<Preview> {
  const { mark, rules, sizing } = await sizeAtMarket(plan.type, plan.inputs);
  const preview = buildPreview(plan.type, plan.inputs, sizing, rules, mark.fundingRate);
  preview.execution = await executionFor(sizing);
  return preview;
}

/** The user accepted the plan's risk disclosures. Required before any deposit or order. */
export async function acknowledgeRisks(userId: string, planId: string): Promise<PlanRow> {
  const plan = await loadPlan(userId, planId);
  if (!plan.risk_ack_at) await db()`update plans set risk_ack_at = now() where id = ${plan.id} and risk_ack_at is null`;
  return loadPlan(userId, planId);
}

const RISK_ACK_REQUIRED = "Read and accept the risks on the preview before funding this plan.";

// ── Deposits ──

export interface PreparedDeposit {
  needed: boolean;
  depositId?: string;
  unsignedTx?: string;
  lovelace?: string;
  usdValue?: number;
  expiresAt?: number;
  availableUsd: number;
}

export async function prepareDeposit(
  userId: string,
  planId: string,
  purpose: "open" | "topup",
  p: { address: string; utxos: string[]; amountUsd?: number }
): Promise<PreparedDeposit> {
  const plan = await loadPlan(userId, planId);
  const keys = await strikeKeysFor(userId);
  const available = await spendableUsd(keys, userId, plan.id);
  let usd: number;

  if (purpose === "open") {
    if (plan.status !== "draft" && plan.status !== "funding") throw new HttpError(409, "This plan is already open");
    if (!plan.risk_ack_at) throw new HttpError(409, RISK_ACK_REQUIRED);
    const [inFlight] = await db()`
      select id from deposits where plan_id = ${plan.id} and purpose = 'open' and status = 'submitted'`;
    if (inFlight) throw new HttpError(409, "Your deposit is still confirming on Cardano. Locke opens the plan when it lands.");
    const [clash] = await db()`
      select id from plans where user_id = ${userId} and symbol = ${plan.symbol}
        and status in ('funding','opening','active','closing') and id <> ${plan.id}`;
    if (clash) throw new HttpError(409, `You already have a live plan on ${plan.symbol}. Close it first.`);
    // Re-size at today's price so the deposit matches what will actually be ordered.
    const { sizing } = await sizeAtMarket(plan.type, plan.inputs);
    const [resized] = await db()`update plans set sizing = ${db().json(sizing as never)}, size = ${sizing.size}, updated_at = now()
               where id = ${plan.id} and status in ('draft','funding') returning id`;
    if (!resized) throw new HttpError(409, "This plan is already opening");
    const shortfall = sizing.requiredUsd * DEPOSIT_CUSHION - available;
    if (shortfall <= 0) return { needed: false, availableUsd: available };
    usd = Math.max(MIN_DEPOSIT_USD, shortfall);
  } else {
    if (plan.status !== "active") throw new HttpError(409, "Top-ups are for open plans");
    const amt = Number(p.amountUsd);
    if (!isFinite(amt) || amt <= 0) throw new HttpError(400, "Enter a top-up amount");
    usd = Math.min(Math.max(MIN_DEPOSIT_USD, amt), 1_000_000);
  }

  if (
    !Array.isArray(p.utxos) ||
    p.utxos.length === 0 ||
    p.utxos.length > 300 ||
    p.utxos.some((u) => typeof u !== "string" || u.length > 20_000 || !/^[0-9a-f]+$/i.test(u))
  ) {
    throw new HttpError(400, "Wallet UTxOs are required for a Cardano deposit");
  }
  const ada = await getMarkPrice("ADA-USD");
  let lovelace = BigInt(Math.ceil((usd / ada.mark) * 1_000_000));
  let quote = await depositQuote(keys, lovelace);
  const quoted = parseFloat(quote.quote.usd_value);
  if (quoted > 0 && quoted < usd) {
    // Strike's conversion rate is a little below mark; scale up once so the plan isn't short.
    lovelace = BigInt(Math.ceil(Number(lovelace) * (usd / quoted) * 1.005));
    quote = await depositQuote(keys, lovelace);
  }
  const built = await depositBuildTx(keys, quote.request_id, p.address, p.utxos);
  const usdValue = parseFloat(quote.quote.usd_value);
  const [dep] = await db()`
    insert into deposits (user_id, plan_id, purpose, request_id, lovelace, usd_value)
    values (${userId}, ${plan.id}, ${purpose}, ${quote.request_id}, ${lovelace.toString()}, ${usdValue})
    returning id`;
  return {
    needed: true,
    depositId: dep.id,
    unsignedTx: built.unsigned_tx,
    lovelace: lovelace.toString(),
    usdValue,
    expiresAt: built.expires_at,
    availableUsd: available,
  };
}

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === "23505";

export async function confirmDeposit(userId: string, depositId: string, txHash: string) {
  if (!/^[0-9a-f]{64}$/i.test(txHash)) throw new HttpError(400, "Invalid transaction hash");
  if (!/^[0-9a-f-]{36}$/i.test(depositId)) throw new HttpError(404, "Deposit not found");
  const hash = txHash.toLowerCase();
  const sql = db();
  const [dep] = await sql`select * from deposits where id = ${depositId} and user_id = ${userId}`;
  if (!dep) throw new HttpError(404, "Deposit not found");
  if (dep.status !== "built") {
    if (dep.tx_hash && dep.tx_hash !== hash) throw new HttpError(409, "This deposit was already confirmed with another transaction");
    return { status: dep.status };
  }
  const keys = await strikeKeysFor(userId);
  try {
    await depositConfirm(keys, dep.request_id, hash);
  } catch (e) {
    // 409 = Strike already has this quote's tx (a retry after a lost response); treat as submitted.
    if (!(e instanceof StrikeError && e.status === 409)) throw e;
  }
  try {
    await sql`update deposits set status = 'submitted', tx_hash = ${hash}, updated_at = now()
              where id = ${depositId} and status = 'built'`;
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, "This transaction was already used for another deposit");
    throw e;
  }
  if (dep.plan_id && dep.purpose === "open") {
    try {
      await transition(dep.plan_id, ["draft"], "funding", { status_note: "Waiting for the deposit to confirm on Cardano" });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      await safeEvent(dep.plan_id, "action", "Another plan on this market is already live, so this one can't open. The deposit stays on your Strike balance.");
    }
  }
  if (dep.plan_id) {
    const ada = (Number(dep.lovelace) / 1e6).toFixed(2);
    await safeEvent(dep.plan_id, "info", `Deposit of ${ada} ADA submitted`, { txHash: hash, purpose: dep.purpose });
  }
  return { status: "submitted" };
}

/**
 * Settle deposits from Strike's transaction history: credited, failed, or expired. Built rows are
 * matched by request id too (the wallet may have submitted even if the confirm call was lost).
 * Every status change is compare-and-set, so browser and worker syncing at once can't apply twice.
 */
async function reconcileDeposits(userId: string, keys: ApiKeys) {
  const sql = db();
  const open = await sql`select * from deposits where user_id = ${userId} and status in ('built','submitted')`;
  if (open.length === 0) return;
  const history = await getDepositHistory(keys);
  for (const dep of open) {
    const tx = history.find(
      (h) => (dep.tx_hash && (h.tx_hash ?? "").toLowerCase() === dep.tx_hash) || (h.request_id && h.request_id === dep.request_id)
    );
    if (tx && (tx.status === "completed" || tx.status === "settled")) {
      const credited = Math.abs(parseFloat(tx.amount)) || Number(dep.usd_value);
      const [won] = await sql`update deposits set status = 'credited', usd_value = ${credited},
                                tx_hash = coalesce(tx_hash, ${(tx.tx_hash ?? "").toLowerCase() || null}), updated_at = now()
                              where id = ${dep.id} and status in ('built','submitted') returning id`;
      if (won && dep.plan_id) {
        await safeEvent(dep.plan_id, "info", `Deposit credited on Strike: $${credited.toFixed(2)}`);
        if (dep.purpose === "open") await transition(dep.plan_id, ["draft"], "funding", { status_note: "Deposit credited" }).catch(() => null);
      }
      continue;
    }
    const failed = tx && (tx.status === "failed" || tx.status === "cancelled");
    const ageMs = Date.now() - new Date(dep.created_at).getTime();
    const expired = !tx && (dep.status === "built" ? ageMs > BUILT_TTL_MS : ageMs > SUBMITTED_TTL_MS);
    if (!failed && !expired) continue;
    const [won] = await sql`update deposits set status = 'failed', updated_at = now()
                            where id = ${dep.id} and status = ${dep.status} returning id`;
    // An unsigned deposit that expired is just abandoned: no event, nothing to tell.
    if (!won || !dep.plan_id || dep.status === "built") continue;
    await safeEvent(
      dep.plan_id,
      "action",
      failed
        ? "Deposit failed on Strike. Nothing was charged beyond network fees; try again."
        : "Strike never received this deposit (the transaction may have been dropped). Check your wallet, then fund again."
    );
    if (dep.purpose === "open") {
      const [stillOpen] = await sql`select id from deposits where plan_id = ${dep.plan_id} and purpose = 'open' and status in ('submitted','credited')`;
      if (!stillOpen) await transition(dep.plan_id, ["funding"], "draft", { status_note: "Deposit didn't arrive" });
    }
  }
}

// ── Opening ──

/**
 * Place the hedge. Every check runs before anything is sent; a failure there leaves the plan
 * where it was, with the reason on the plan (once). Only one caller can move a plan into opening,
 * and the order itself is tracked (see resolvePending).
 */
export async function openPlan(userId: string, planId: string): Promise<PlanRow> {
  let plan = await loadPlan(userId, planId);
  if (plan.status === "opening" || plan.status === "active") return plan;
  if (plan.status !== "draft" && plan.status !== "funding") throw new HttpError(409, `Plan is ${plan.status}`);
  if (!plan.risk_ack_at) throw new HttpError(409, RISK_ACK_REQUIRED);
  if (plan.pending_order) return plan;
  const keys = await strikeKeysFor(userId);

  const [waiting] = await db()`
    select id from deposits where plan_id = ${plan.id} and purpose = 'open' and status = 'submitted'`;
  if (waiting) throw new HttpError(409, "Waiting for your deposit to be credited on Strike");

  const sizing = plan.sizing;
  try {
    // A position already on this market (opened in Strike's app, or left over) would be merged into
    // the hedge and closed with it. Refuse instead.
    if (await getPosition(keys, plan.symbol)) {
      throw new HttpError(409, `This Strike account already has an open ${plan.symbol} position. Close it in Strike before opening this plan.`);
    }
    const spendable = await spendableUsd(keys, userId, plan.id);
    const needed = sizing.initialMarginUsd + sizing.openFeeUsd;
    if (spendable < needed) {
      throw new HttpError(409, `Strike balance for this plan is $${spendable.toFixed(2)}; it needs $${needed.toFixed(2)} to open. Fund it first.`);
    }
    await assertFillable(plan.symbol, plan.side, plan.size);
  } catch (e) {
    if (e instanceof HttpError || e instanceof StrikeError) await noteOnce(plan, `Waiting to open: ${e.message}`);
    throw e;
  }

  const claimed = await transition(plan.id, ["draft", "funding"], "opening", { status_note: "Placing the hedge on Strike" });
  if (!claimed) return loadPlan(userId, planId);
  plan = claimed;

  try {
    let setError: unknown = null;
    try {
      await setMarginMode(keys, plan.symbol, "isolated");
    } catch (e) {
      setError = e; // refused when the mode is already set; confirmed below
    }
    const setting = await getSymbolSetting(keys, plan.symbol);
    if (setting ? setting.margin_mode !== "isolated" : setError) {
      throw new HttpError(409, `Couldn't put ${plan.symbol} in isolated margin on this Strike account. Close any open ${plan.symbol} orders in Strike, then try again.`);
    }
    await setLeverage(keys, plan.symbol, sizing.leverage);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Couldn't prepare the order";
    await transition(plan.id, ["opening"], "funding", { status_note: msg });
    await safeEvent(plan.id, "action", `Could not open the hedge: ${msg}`);
    throw e;
  }

  const clientId = await claimOrder(plan.id, "open");
  if (!clientId) return loadPlan(userId, planId);
  try {
    await sendClaimedOrder(keys, plan, clientId, { side: plan.side, size: plan.size });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Order refused";
    await transition(plan.id, ["opening"], "funding", { status_note: msg });
    await safeEvent(plan.id, "action", `Could not open the hedge: ${msg}`);
    throw e;
  }
  await safeEvent(plan.id, "info", `Hedge order sent: ${plan.side === "sell" ? "SELL" : "BUY"} ${plan.size} ${plan.symbol}`, { clientOrderId: clientId });
  return settleSoon(keys, plan.id);
}

// ── Sync: advance any plan that is waiting on Strike ──

export async function syncPlan(userId: string, planId: string): Promise<PlanRow> {
  let plan = await loadPlan(userId, planId);
  if (plan.status === "closed" || plan.status === "failed") return plan;
  const keys = await strikeKeysFor(userId);
  await reconcileDeposits(userId, keys);
  plan = await loadPlan(userId, planId);
  if (plan.status === "draft" || plan.status === "closed") return plan;
  const sql = db();

  let pos = await getPosition(keys, plan.symbol);
  if (plan.pending_order) {
    plan = await resolvePending(keys, plan, pos);
    if (plan.pending_order) return plan; // still in flight
  }

  if (plan.status === "funding" && plan.order_seq < AUTO_OPEN_ATTEMPTS && plan.risk_ack_at) {
    const deps = await sql`select status from deposits where plan_id = ${plan.id} and purpose = 'open' and tx_hash is not null`;
    if (deps.some((d) => d.status === "credited") && !deps.some((d) => d.status === "submitted")) {
      try {
        plan = await openPlan(userId, planId);
      } catch {
        return loadPlan(userId, planId); // the reason is on the plan; the next sync tries again
      }
      if (plan.pending_order || plan.status !== "active") return plan;
      pos = await getPosition(keys, plan.symbol);
    }
  }

  if (plan.status === "opening") {
    // The order filled but its position arrived after the order settled.
    if (pos) plan = (await activate(plan, pos)) ?? (await loadPlan(userId, planId));
    else if (Date.now() - new Date(plan.updated_at).getTime() > 5 * 60_000) {
      const note = "The hedge order didn't leave a position on Strike. Your funds stay on Strike; open again to retry.";
      const won = await transition(plan.id, ["opening"], "funding", { status_note: note });
      if (won) await safeEvent(plan.id, "action", note);
      plan = won ?? (await loadPlan(userId, planId));
    }
  }

  if (plan.status === "active" && pos) {
    if (plan.missing_since) await sql`update plans set missing_since = null where id = ${plan.id}`;
    await applyBuffer(keys, plan, pos);
    await applyTopUps(keys, plan, pos);
  }

  if (plan.status === "active" && !pos) {
    // One empty read isn't proof: Strike can briefly return no positions. Close after a grace period.
    if (!plan.missing_since) {
      await sql`update plans set missing_since = now() where id = ${plan.id} and missing_since is null`;
      return loadPlan(userId, planId);
    }
    if (Date.now() - new Date(plan.missing_since).getTime() < MISSING_GRACE_MS) return plan;
    const won = await transition(plan.id, ["active"], "closed", { closed: true, status_note: null });
    if (won) await safeEvent(plan.id, "liquidation", "The position is no longer open on Strike (closed outside Locke or liquidated).");
    return won ?? (await loadPlan(userId, planId));
  }

  if (plan.status === "closing") {
    if (!pos) {
      const won = await transition(plan.id, ["closing"], "closed", { closed: true, status_note: null });
      if (won) await safeEvent(plan.id, "info", "Plan closed. Margin is back on your Strike balance.");
      return won ?? (await loadPlan(userId, planId));
    }
    // Still open after the close settled (partial fill): send the reduce-only close again.
    if (Date.now() - new Date(plan.updated_at).getTime() > CLOSE_RETRY_MS) await sendClose(keys, plan, pos).catch(() => null);
    return loadPlan(userId, planId);
  }
  return plan;
}

/** Add the buffer margin once, verified, from balance this plan may spend. */
async function applyBuffer(keys: ApiKeys, plan: PlanRow, pos: StrikePosition) {
  if (plan.buffer_added) return;
  const [claimed] = await db()`update plans set buffer_added = true, updated_at = now()
                               where id = ${plan.id} and buffer_added = false returning id`;
  if (!claimed) return;
  plan.buffer_added = true;
  const spendable = await spendableUsd(keys, plan.user_id, plan.id).catch(() => 0);
  const amount = Math.min(plan.sizing.bufferMarginUsd, Math.max(0, spendable - 0.05));
  if (amount < Math.min(plan.sizing.bufferMarginUsd, 1)) {
    await db()`update plans set buffer_added = false where id = ${plan.id}`;
    plan.buffer_added = false;
    await noteOnce(plan, "Waiting for free balance on Strike to add this plan's buffer margin.");
    return;
  }
  if (!(await addMarginVerified(keys, plan, amount, pos))) {
    await db()`update plans set buffer_added = false where id = ${plan.id}`;
    plan.buffer_added = false;
    return;
  }
  if (plan.status_note) await db()`update plans set status_note = null where id = ${plan.id}`;
  await safeEvent(plan.id, "info", `Added $${amount.toFixed(2)} buffer margin to this plan`);
}

/** Add credited top-ups to this plan's isolated margin, each exactly once and verified. */
async function applyTopUps(keys: ApiKeys, plan: PlanRow, pos: StrikePosition) {
  const sql = db();
  const topups = await sql`select * from deposits where plan_id = ${plan.id} and purpose = 'topup' and status = 'credited'`;
  for (const t of topups) {
    const [claimed] = await sql`update deposits set status = 'applied', updated_at = now()
                                where id = ${t.id} and status = 'credited' returning id`;
    if (!claimed) continue;
    const want = Number(t.usd_value);
    const spendable = await spendableUsd(keys, plan.user_id, plan.id).catch(() => 0);
    const amount = Math.min(want, Math.max(0, spendable - 0.05));
    // Strike credits a little under the quote after conversion; anything far short means the money isn't there yet.
    const ok = amount >= want * 0.9 && (await addMarginVerified(keys, plan, amount, pos));
    if (!ok) {
      await sql`update deposits set status = 'credited', updated_at = now() where id = ${t.id} and status = 'applied'`;
      continue;
    }
    await sql`update deposits set applied_usd = ${amount} where id = ${t.id}`;
    await safeEvent(plan.id, "info", `Top-up of $${amount.toFixed(2)} added to this plan's margin only`);
  }
}

// ── Adjust ──

/** Send (or re-send) the reduce-only close for the current position. */
async function sendClose(keys: ApiKeys, plan: PlanRow, pos: StrikePosition) {
  const clientId = await claimOrder(plan.id, "close");
  if (!clientId) return;
  await db()`update plans set updated_at = now() where id = ${plan.id}`;
  await sendClaimedOrder(keys, plan, clientId, {
    side: plan.side === "sell" ? "buy" : "sell",
    size: Math.abs(parseFloat(pos.size)),
    reduceOnly: true,
  });
  await safeEvent(plan.id, "info", "Close order sent (reduce-only)", { clientOrderId: clientId });
}

export async function closePlan(userId: string, planId: string): Promise<PlanRow> {
  const plan = await loadPlan(userId, planId);
  if (plan.status === "draft" || plan.status === "funding") {
    // Compare-and-set: if the worker just started opening it, discarding would orphan a live hedge.
    const won = await transition(plan.id, ["draft", "funding"], "closed", { closed: true });
    if (!won) throw new HttpError(409, "This plan just started opening on Strike. Close it once it's open.");
    return won;
  }
  if (plan.status === "opening") throw new HttpError(409, "This plan just started opening on Strike. Close it once it's open.");
  if (plan.status !== "active") throw new HttpError(409, `Plan is ${plan.status}`);
  if (plan.pending_order) throw new HttpError(409, "Another change to this plan is still settling on Strike. Try again in a moment.");
  const keys = await strikeKeysFor(userId);
  const pos = await getPosition(keys, plan.symbol);
  const claimed = await transition(plan.id, ["active"], "closing", { status_note: "Closing on Strike" });
  if (!claimed) return loadPlan(userId, planId);
  if (!pos) return syncPlan(userId, planId);
  try {
    await sendClose(keys, claimed, pos);
  } catch (e) {
    await transition(plan.id, ["closing"], "active", { status_note: null });
    throw e;
  }
  await settleSoon(keys, plan.id);
  return syncPlan(userId, planId);
}

/**
 * Resize. Holdings: new share and/or amount held. Costs: "month" closes S ÷ T to match fuel used.
 * The new size is computed here from the stored plan, never taken from the request. The order's
 * slot doubles as a lock: a second resize (double-click, two tabs) is refused while one settles.
 */
export async function resizePlan(userId: string, planId: string, raw: Record<string, unknown>): Promise<PlanRow> {
  const plan = await loadPlan(userId, planId);
  if (plan.status !== "active") throw new HttpError(409, "Only open plans can be resized");
  if (plan.pending_order) throw new HttpError(409, "Another change to this plan is still settling on Strike. Try again in a moment.");
  const keys = await strikeKeysFor(userId);
  const pos = await getPosition(keys, plan.symbol);
  if (!pos) throw new HttpError(409, "No open position on Strike for this plan");
  const current = Math.abs(parseFloat(pos.size));
  const rules = await getMarketRules(plan.symbol);
  let inputs: PlanInputs = plan.inputs;
  let target: number;

  if (plan.type === "holdings") {
    inputs = parseInputs("holdings", { ...plan.inputs, ...pick(raw, ["sharePct", "amountHeld"]) });
    const h = inputs as HoldingsInputs;
    target = Math.floor(((h.amountHeld * h.sharePct) / 100) / rules.stepSize) * rules.stepSize;
  } else {
    if (raw.action !== "month") throw new HttpError(400, "Unknown resize action");
    const c = plan.inputs as CostsInputs;
    if (c.months <= 1) throw new HttpError(409, "Last month: close the plan instead");
    const perMonth = current / c.months;
    target = current - perMonth;
    inputs = { ...c, months: c.months - 1 };
  }
  const decimals = Math.max(0, -Math.floor(Math.log10(rules.stepSize)));
  target = Number(Math.max(0, target).toFixed(decimals));
  const delta = Number((target - current).toFixed(decimals));
  if (Math.abs(delta) < rules.minQty) throw new HttpError(400, "That change is smaller than Strike's minimum order");
  const mark = (await getMarkPrice(plan.symbol)).mark;
  if (Math.abs(delta) * mark < rules.minNotional && target > 0) {
    throw new HttpError(400, `Strike's minimum order is $${rules.minNotional}; this change is too small`);
  }
  if (delta > 0) {
    const need = (delta * mark) / plan.sizing.leverage;
    if ((await spendableUsd(keys, userId, plan.id)) < need) {
      throw new HttpError(409, `Adding to the hedge needs $${need.toFixed(2)} on Strike. Top up first.`);
    }
    await assertFillable(plan.symbol, plan.side, delta);
  }
  const clientId = await claimOrder(plan.id, "resize", { inputs, target, name: planName(plan.type, inputs), from: current });
  if (!clientId) throw new HttpError(409, "Another change to this plan is still settling on Strike. Try again in a moment.");
  const reducing = delta < 0;
  await sendClaimedOrder(keys, plan, clientId, {
    side: reducing ? (plan.side === "sell" ? "buy" : "sell") : plan.side,
    size: Math.abs(delta),
    reduceOnly: reducing,
  });
  await safeEvent(plan.id, "info", `Resize order sent: ${current} → ${target}`, { clientOrderId: clientId });
  return settleSoon(keys, plan.id);
}

function pick(o: Record<string, unknown>, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

// ── Live view ──

export interface PlanView {
  id: string;
  type: PlanType;
  name: string;
  status: PlanStatus;
  statusNote: string | null;
  label: string;
  symbol: string;
  side: "buy" | "sell";
  inputs: PlanInputs;
  sizing: Sizing;
  createdAt: string;
  openedAt: string | null;
  mark: number;
  hourlyFundingRate: number;
  position: null | {
    size: number;
    entry: number;
    isoBalance: number;
    upnl: number;
    maintenanceMargin: number;
    liquidationPrice: number | null;
    fundingToDate: number;
    leverage: number;
  };
  ratio: number | null;
  /** Fractional distance from mark to liquidation (0.1 = 10%). */
  liquidationDistance: number | null;
  riskLevel: RiskLevel;
  headline: number;
  headlineUnit: string;
  fundingPerDay: number;
  suggestedTopUpUsd: number;
  alertPrice: number | null;
  thresholds: Thresholds;
  demoAlerts: boolean;
  /** The fee each order carries: the server setting, capped at what this user approved. */
  builderFeeBps: number;
  /** Strike or the price feed couldn't be read: the numbers below are not live; don't show it as healthy. */
  liveUnavailable: boolean;
  riskAcknowledged: boolean;
  /** An order is in flight on Strike (open, close or resize) and settling. */
  pendingAction: OrderAction | null;
}

/**
 * A plan with live numbers. `pos` is the Strike position: null when there is none, undefined when
 * Strike couldn't be read. Never throws for Strike or the price feed being down: the view says
 * the numbers aren't live instead of showing a stale plan as healthy.
 */
export async function planView(plan: PlanRow, pos: StrikePosition | null | undefined): Promise<PlanView> {
  const [markLive, rulesLive, link] = await Promise.all([
    getMarkPrice(plan.symbol).catch(() => null),
    getMarketRules(plan.symbol).catch(() => null),
    db()`select fee_share_bps from strike_links where user_id = ${plan.user_id}`.catch(() => []),
  ]);
  const fallbackPrice = Number(plan.entry_price ?? plan.sizing.price);
  const mark = markLive ?? { mark: fallbackPrice, fundingRate: 0 };
  const rules = rulesLive;
  const th = thresholds();
  const liveStatus = plan.status === "active" || plan.status === "closing";
  const liveUnavailable = liveStatus && (pos === undefined || !markLive || !rules);
  const live = pos && liveStatus && markLive && rules;
  let position: PlanView["position"] = null;
  let ratio: number | null = null;
  let suggested = 0;
  let alertPrice: number | null = null;
  let distance: number | null = null;
  let headline: number;

  if (live && pos && rules) {
    const signed = parseFloat(pos.size);
    const entry = parseFloat(pos.entry_price);
    const iso = parseFloat(pos.iso_balance);
    const upnl = signed * (mark.mark - entry);
    const mm = maintenanceMargin(rules.tiers, signed, mark.mark);
    const funding = parseFloat(pos.accumulated_funding_fees) || 0;
    ratio = marginRatio(mm, iso, upnl);
    if (!isFinite(ratio)) ratio = 1;
    position = {
      size: Math.abs(signed),
      entry,
      isoBalance: iso,
      upnl,
      maintenanceMargin: mm,
      liquidationPrice: parseFloat(pos.liquidation_price) || liquidationPrice(rules.tiers, signed, entry, iso),
      fundingToDate: funding,
      leverage: pos.leverage,
    };
    const liq = position.liquidationPrice;
    distance = distanceToLiquidation(signed, mark.mark, liq);
    // Enough to bring the ratio back to target AND push liquidation 25% away from the mark.
    const liqTarget = signed < 0 ? mark.mark * (1 + DISTANCE_LEVELS.target) : mark.mark * (1 - DISTANCE_LEVELS.target);
    const byDistance = Math.max(0, isoForLiquidationAt(rules.tiers, signed, entry, liqTarget) - iso);
    suggested = Math.max(suggestedTopUpUsd(mm, iso, upnl, th.target), byDistance);
    if (config.demoAlerts) suggested = Math.min(suggested, MIN_DEPOSIT_USD);
    const byRatio = priceAtRatio(rules.tiers, signed, entry, iso, th.action);
    const byDist = priceAtDistance(signed, liq, DISTANCE_LEVELS.action);
    alertPrice = byRatio == null ? byDist : byDist == null ? byRatio : signed < 0 ? Math.min(byRatio, byDist) : Math.max(byRatio, byDist);
    headline = liveHeadline(plan.type, plan.inputs, Math.abs(signed), entry, mark.mark, funding);
  } else {
    const entry = Number(plan.entry_price ?? mark.mark);
    // A closed plan is frozen at its entry: it no longer protects anything, so it mustn't move with the market.
    headline = liveHeadline(plan.type, plan.inputs, plan.size, entry, plan.status === "closed" ? entry : mark.mark, 0);
  }

  // Without live numbers, keep the last level the worker recorded rather than claiming "ok".
  const level: RiskLevel = ratio == null ? (liveStatus ? plan.risk_level : "ok") : combinedLevel(ratio, distance, plan.risk_level, th);
  const approved = Number(link[0]?.fee_share_bps);
  const feeBps = Number.isFinite(approved) ? Math.min(config.builderFeeBps, approved) : config.builderFeeBps;
  const signedPlanned = plan.side === "sell" ? -plan.size : plan.size;
  return {
    id: plan.id,
    type: plan.type,
    name: plan.name,
    status: plan.status,
    statusNote: plan.status_note,
    label: PLAN_LABEL[plan.type],
    symbol: plan.symbol,
    side: plan.side,
    inputs: plan.inputs,
    sizing: plan.sizing,
    createdAt: new Date(plan.created_at).toISOString(),
    openedAt: plan.opened_at ? new Date(plan.opened_at).toISOString() : null,
    mark: mark.mark,
    hourlyFundingRate: mark.fundingRate,
    position,
    ratio,
    liquidationDistance: distance,
    riskLevel: level,
    headline,
    headlineUnit: plan.type === "holdings" ? "USD" : `${(plan.inputs as CostsInputs).currency}/L`,
    fundingPerDay: fundingPerDay(position ? (plan.side === "sell" ? -position.size : position.size) : signedPlanned, mark.mark, mark.fundingRate),
    suggestedTopUpUsd: suggested,
    alertPrice,
    thresholds: th,
    demoAlerts: config.demoAlerts,
    builderFeeBps: feeBps,
    liveUnavailable,
    riskAcknowledged: !!plan.risk_ack_at,
    pendingAction: plan.pending_action,
  };
}
