// Plan lifecycle: draft → funding → opening → active → closing → closed.
// Used by the API routes and by the risk worker, so it must not import Next.js modules.
//
// Rules from the spec (section 12): the server recomputes every order from the stored
// plan; sizes from the browser are never trusted. Status transitions are compare-and-set
// updates, so two concurrent callers can't both place the same order.

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
  getPosition,
  getSymbolSetting,
  placeMarketOrder,
  setLeverage,
  setMarginMode,
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
/** How long an open order may take to show up as a position before we call it failed. */
const OPEN_TIMEOUT_MS = 90_000;

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
  extra: Partial<Pick<PlanRow, "status_note" | "entry_price" | "buffer_added">> & { opened?: boolean; closed?: boolean } = {}
): Promise<PlanRow | null> {
  const [row] = await db()`
    update plans set
      status = ${to},
      status_note = ${extra.status_note ?? null},
      entry_price = coalesce(${extra.entry_price ?? null}, entry_price),
      opened_at = case when ${!!extra.opened} then now() else opened_at end,
      closed_at = case when ${!!extra.closed} then now() else closed_at end,
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

async function availableUsd(keys: ApiKeys): Promise<number> {
  const acct = await getAccount(keys);
  return parseFloat(acct.available_balance ?? "0") || 0;
}

export async function prepareDeposit(
  userId: string,
  planId: string,
  purpose: "open" | "topup",
  p: { address: string; utxos: string[]; amountUsd?: number }
): Promise<PreparedDeposit> {
  const plan = await loadPlan(userId, planId);
  const keys = await strikeKeysFor(userId);
  const available = await availableUsd(keys);
  let usd: number;

  if (purpose === "open") {
    if (plan.status !== "draft" && plan.status !== "funding") throw new HttpError(409, "This plan is already open");
    const [inFlight] = await db()`
      select id from deposits where plan_id = ${plan.id} and purpose = 'open' and status = 'submitted'`;
    if (inFlight) throw new HttpError(409, "Your deposit is still confirming on Cardano. Locke opens the plan when it lands.");
    const [clash] = await db()`
      select id from plans where user_id = ${userId} and symbol = ${plan.symbol}
        and status in ('funding','opening','active','closing') and id <> ${plan.id}`;
    if (clash) throw new HttpError(409, `You already have a live plan on ${plan.symbol}. Close it first.`);
    // Re-size at today's price so the deposit matches what will actually be ordered.
    const { sizing } = await sizeAtMarket(plan.type, plan.inputs);
    await db()`update plans set sizing = ${db().json(sizing as never)}, size = ${sizing.size}, updated_at = now()
               where id = ${plan.id}`;
    const shortfall = sizing.requiredUsd * DEPOSIT_CUSHION - available;
    if (shortfall <= 0) return { needed: false, availableUsd: available };
    usd = Math.max(MIN_DEPOSIT_USD, shortfall);
  } else {
    if (plan.status !== "active") throw new HttpError(409, "Top-ups are for open plans");
    const amt = Number(p.amountUsd);
    if (!isFinite(amt) || amt <= 0) throw new HttpError(400, "Enter a top-up amount");
    usd = Math.min(Math.max(MIN_DEPOSIT_USD, amt), 1_000_000);
  }

  if (!Array.isArray(p.utxos) || p.utxos.length === 0 || p.utxos.some((u) => typeof u !== "string" || !/^[0-9a-f]+$/i.test(u))) {
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

export async function confirmDeposit(userId: string, depositId: string, txHash: string) {
  if (!/^[0-9a-f]{64}$/i.test(txHash)) throw new HttpError(400, "Invalid transaction hash");
  if (!/^[0-9a-f-]{36}$/i.test(depositId)) throw new HttpError(404, "Deposit not found");
  const sql = db();
  const [dep] = await sql`select * from deposits where id = ${depositId} and user_id = ${userId}`;
  if (!dep) throw new HttpError(404, "Deposit not found");
  if (dep.status !== "built") return { status: dep.status };
  const keys = await strikeKeysFor(userId);
  try {
    await depositConfirm(keys, dep.request_id, txHash.toLowerCase());
  } catch (e: any) {
    // 409 = Strike already has this quote's tx; treat as submitted.
    if (e?.status !== 409) throw e;
  }
  await sql`update deposits set status = 'submitted', tx_hash = ${txHash.toLowerCase()}, updated_at = now()
            where id = ${depositId}`;
  if (dep.plan_id && dep.purpose === "open") {
    await transition(dep.plan_id, ["draft"], "funding", { status_note: "Waiting for the deposit to confirm on Cardano" });
  }
  if (dep.plan_id) {
    const ada = (Number(dep.lovelace) / 1e6).toFixed(2);
    await addEvent(dep.plan_id, "info", `Deposit of ${ada} ADA submitted`, { txHash, purpose: dep.purpose });
  }
  return { status: "submitted" };
}

/** Mark submitted deposits as credited (or failed) from Strike's transaction history. */
async function reconcileDeposits(userId: string, keys: ApiKeys) {
  const sql = db();
  const pending = await sql`select * from deposits where user_id = ${userId} and status = 'submitted'`;
  if (pending.length === 0) return;
  const history = await getDepositHistory(keys);
  for (const dep of pending) {
    const tx = history.find(
      (h) => (h.tx_hash ?? "").toLowerCase() === dep.tx_hash || (h.request_id && h.request_id === dep.request_id)
    );
    if (!tx) continue;
    if (tx.status === "completed" || tx.status === "settled") {
      const credited = Math.abs(parseFloat(tx.amount)) || Number(dep.usd_value);
      await sql`update deposits set status = 'credited', usd_value = ${credited}, updated_at = now() where id = ${dep.id}`;
      if (dep.plan_id) await addEvent(dep.plan_id, "info", `Deposit credited on Strike: $${credited.toFixed(2)}`);
    } else if (tx.status === "failed" || tx.status === "cancelled") {
      await sql`update deposits set status = 'failed', updated_at = now() where id = ${dep.id}`;
      if (dep.plan_id) {
        await addEvent(dep.plan_id, "action", "Deposit failed on Strike. Nothing was charged beyond network fees; try again.");
        await transition(dep.plan_id, ["funding"], "draft", { status_note: "Deposit failed" });
      }
    }
  }
}

// ── Opening ──

/** Place the hedge. Only one caller can move a plan into `opening`. */
export async function openPlan(userId: string, planId: string): Promise<PlanRow> {
  const plan = await loadPlan(userId, planId);
  if (plan.status === "opening" || plan.status === "active") return plan;
  if (plan.status !== "draft" && plan.status !== "funding") throw new HttpError(409, `Plan is ${plan.status}`);
  const keys = await strikeKeysFor(userId);

  const [waiting] = await db()`
    select id from deposits where plan_id = ${plan.id} and purpose = 'open' and status in ('built','submitted')
      and created_at > now() - interval '2 hours' and tx_hash is not null`;
  if (waiting) throw new HttpError(409, "Waiting for your deposit to be credited on Strike");

  const sizing = plan.sizing;
  const available = await availableUsd(keys);
  const needed = sizing.initialMarginUsd + sizing.openFeeUsd;
  if (available < needed) {
    throw new HttpError(409, `Strike balance is $${available.toFixed(2)}; this plan needs $${needed.toFixed(2)} to open. Fund it first.`);
  }
  try {
    await assertFillable(plan.symbol, plan.side, plan.size);
  } catch (e) {
    // Say why on the plan, once: the worker retries on every sync.
    if (e instanceof ThinBookError && plan.status_note !== e.message) {
      await db()`update plans set status_note = ${e.message}, updated_at = now() where id = ${plan.id}`;
      await addEvent(plan.id, "watch", `Waiting to open: ${e.message}`);
    }
    throw e;
  }

  const claimed = await transition(plan.id, ["draft", "funding"], "opening", { status_note: "Placing the hedge on Strike" });
  if (!claimed) return loadPlan(userId, planId);

  try {
    try {
      await setMarginMode(keys, plan.symbol, "isolated");
    } catch {
      /* Refused when a position or orders exist; confirmed below. */
    }
    const setting = await getSymbolSetting(keys, plan.symbol);
    if (setting && setting.margin_mode !== "isolated") {
      throw new HttpError(409, `${plan.symbol} has an open position or orders in cross margin on this Strike account. Close them first.`);
    }
    await setLeverage(keys, plan.symbol, sizing.leverage);
    await placeMarketOrder(keys, {
      symbol: plan.symbol,
      side: plan.side,
      size: String(plan.size),
      clientOrderId: `locke-${plan.id}-open-${Date.now().toString(36)}`,
    });
    await addEvent(plan.id, "info", `Hedge order sent: ${plan.side === "sell" ? "SELL" : "BUY"} ${plan.size} ${plan.symbol}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Order failed";
    await transition(plan.id, ["opening"], "funding", { status_note: msg });
    await addEvent(plan.id, "action", `Could not open the hedge: ${msg}`);
    throw e;
  }
  return loadPlan(userId, planId);
}

// ── Sync: advance any plan that is waiting on Strike ──

export async function syncPlan(userId: string, planId: string): Promise<PlanRow> {
  let plan = await loadPlan(userId, planId);
  if (plan.status === "closed" || plan.status === "draft" || plan.status === "failed") return plan;
  const keys = await strikeKeysFor(userId);
  await reconcileDeposits(userId, keys);
  const sql = db();

  if (plan.status === "funding") {
    const deps = await sql`select status from deposits where plan_id = ${plan.id} and purpose = 'open' and tx_hash is not null`;
    const credited = deps.some((d) => d.status === "credited");
    const pending = deps.some((d) => d.status === "submitted");
    if (credited && !pending) {
      await sql`update deposits set status = 'applied', updated_at = now() where plan_id = ${plan.id} and purpose = 'open' and status = 'credited'`;
      try {
        plan = await openPlan(userId, planId);
      } catch (e) {
        // Nothing reached Strike: hand the deposit back so the next sync tries again.
        if (e instanceof ThinBookError) {
          await sql`update deposits set status = 'credited', updated_at = now() where plan_id = ${plan.id} and purpose = 'open' and status = 'applied'`;
        }
        return loadPlan(userId, planId);
      }
    }
  }

  const pos = await getPosition(keys, plan.symbol);

  if (plan.status === "opening") {
    if (pos) {
      const entry = parseFloat(pos.entry_price);
      const won = await transition(plan.id, ["opening"], "active", { entry_price: entry, opened: true, status_note: null });
      if (won) await addEvent(plan.id, "info", `Hedge open on Strike at ${entry}`, { size: pos.size });
      plan = won ?? (await loadPlan(userId, planId));
    } else if (Date.now() - new Date(plan.updated_at).getTime() > OPEN_TIMEOUT_MS) {
      const won = await transition(plan.id, ["opening"], "funding", { status_note: "The order did not fill. Try opening again." });
      if (won) await addEvent(plan.id, "action", "The hedge order did not fill. Funds stay on your Strike balance; open again to retry.");
      plan = won ?? (await loadPlan(userId, planId));
    }
  }

  if (plan.status === "active" && pos) {
    // Claim the buffer step first so a concurrent sync (worker and browser) can't add it twice.
    const [claimedBuffer] = plan.buffer_added
      ? []
      : await sql`update plans set buffer_added = true, updated_at = now()
                  where id = ${plan.id} and buffer_added = false returning id`;
    if (claimedBuffer) {
      plan.buffer_added = true;
      try {
        const available = await availableUsd(keys);
        const amount = Math.min(plan.sizing.bufferMarginUsd, Math.max(0, available - 0.05));
        if (amount >= 0.01) {
          await addIsolatedMargin(keys, plan.symbol, amount);
          await addEvent(plan.id, "info", `Added $${amount.toFixed(2)} buffer margin to this plan`);
        }
      } catch (e) {
        await sql`update plans set buffer_added = false where id = ${plan.id}`;
        throw e;
      }
    }
    const topups = await sql`select * from deposits where plan_id = ${plan.id} and purpose = 'topup' and status = 'credited'`;
    for (const t of topups) {
      const [claimed] = await sql`update deposits set status = 'applied', updated_at = now()
                                  where id = ${t.id} and status = 'credited' returning id`;
      if (!claimed) continue;
      const available = await availableUsd(keys);
      const amount = Math.min(Number(t.usd_value), Math.max(0, available - 0.05));
      if (amount >= 0.01) {
        await addIsolatedMargin(keys, plan.symbol, amount);
        await addEvent(plan.id, "info", `Top-up of $${amount.toFixed(2)} added to this plan's margin only`);
      }
    }
  }

  if ((plan.status === "active" || plan.status === "closing") && !pos) {
    const wasClosing = plan.status === "closing";
    const won = await transition(plan.id, ["active", "closing"], "closed", { closed: true, status_note: null });
    if (won) {
      await addEvent(
        plan.id,
        wasClosing ? "info" : "liquidation",
        wasClosing ? "Plan closed. Margin is back on your Strike balance." : "The position is no longer open on Strike (closed outside Locke or liquidated)."
      );
    }
    plan = won ?? (await loadPlan(userId, planId));
  }
  return plan;
}

// ── Adjust ──

export async function closePlan(userId: string, planId: string): Promise<PlanRow> {
  const plan = await loadPlan(userId, planId);
  if (plan.status === "draft" || plan.status === "funding") {
    await db()`update plans set status = 'closed', closed_at = now(), updated_at = now() where id = ${plan.id}`;
    return loadPlan(userId, planId);
  }
  if (plan.status !== "active") throw new HttpError(409, `Plan is ${plan.status}`);
  const keys = await strikeKeysFor(userId);
  const pos = await getPosition(keys, plan.symbol);
  const claimed = await transition(plan.id, ["active"], "closing", { status_note: "Closing on Strike" });
  if (!claimed) return loadPlan(userId, planId);
  if (!pos) return syncPlan(userId, planId);
  try {
    await placeMarketOrder(keys, {
      symbol: plan.symbol,
      side: plan.side === "sell" ? "buy" : "sell",
      size: String(Math.abs(parseFloat(pos.size))),
      clientOrderId: `locke-${plan.id}-close-${Date.now().toString(36)}`,
      reduceOnly: true,
    });
  } catch (e) {
    await transition(plan.id, ["closing"], "active", { status_note: null });
    throw e;
  }
  await addEvent(plan.id, "info", "Close order sent (reduce-only)");
  return loadPlan(userId, planId);
}

/**
 * Resize. Holdings: new share and/or amount held. Costs: "month" closes S ÷ T to match fuel used.
 * The new size is computed here from the stored plan, never taken from the request.
 */
export async function resizePlan(userId: string, planId: string, raw: Record<string, unknown>): Promise<PlanRow> {
  const plan = await loadPlan(userId, planId);
  if (plan.status !== "active") throw new HttpError(409, "Only open plans can be resized");
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
    if ((await availableUsd(keys)) < need) throw new HttpError(409, `Adding to the hedge needs $${need.toFixed(2)} on Strike. Top up first.`);
    await assertFillable(plan.symbol, plan.side, delta);
  }
  const reducing = delta < 0;
  await placeMarketOrder(keys, {
    symbol: plan.symbol,
    side: reducing ? (plan.side === "sell" ? "buy" : "sell") : plan.side,
    size: String(Math.abs(delta)),
    clientOrderId: `locke-${plan.id}-resize-${Date.now().toString(36)}`,
    reduceOnly: reducing,
  });
  const sql = db();
  await sql`update plans set inputs = ${sql.json(inputs as never)}, size = ${target}, name = ${planName(plan.type, inputs)},
            updated_at = now() where id = ${plan.id}`;
  await addEvent(plan.id, "info", `Hedge resized from ${current} to ${target}`);
  return loadPlan(userId, planId);
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
  builderFeeBps: number;
}

export async function planView(plan: PlanRow, pos: StrikePosition | null | undefined): Promise<PlanView> {
  const [mark, rules] = await Promise.all([getMarkPrice(plan.symbol), getMarketRules(plan.symbol)]);
  const th = thresholds();
  const live = pos && (plan.status === "active" || plan.status === "closing");
  let position: PlanView["position"] = null;
  let ratio: number | null = null;
  let suggested = 0;
  let alertPrice: number | null = null;
  let distance: number | null = null;
  let headline: number;

  if (live && pos) {
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
    const entry = plan.entry_price ?? mark.mark;
    headline = liveHeadline(plan.type, plan.inputs, plan.size, entry, mark.mark, 0);
  }

  const level: RiskLevel = ratio == null ? "ok" : combinedLevel(ratio, distance, plan.risk_level, th);
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
    builderFeeBps: config.builderFeeBps,
  };
}
