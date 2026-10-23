// Plan sizing, scenario preview and replay (spec sections 4 and 9).
// Pure functions: every price, rule and fee comes in as an argument.

import { budgetCover, isCountry, isFuelType, type FuelType } from "./fuel";
import {
  DISTANCE_LEVELS,
  fundingPerDay,
  liquidationPrice,
  LOCKE_THRESHOLDS,
  priceAtDistance,
  priceAtRatio,
} from "./risk";
import type {
  CostsInputs,
  FeeRates,
  HoldingsInputs,
  MarketRules,
  PlanInputs,
  PlanType,
  Preview,
  Scenario,
  Side,
  Sizing,
} from "./types";

export const SCENARIO_MOVES = [-0.5, -0.25, -0.1, 0.1, 0.25, 0.5];

export const PLAN_MARKET: Record<PlanType, string> = {
  holdings: "ADA-USD",
  costs: "WTI-USD",
};

export const PLAN_SIDE: Record<PlanType, Side> = {
  holdings: "sell",
  costs: "buy",
};

export const PLAN_LABEL: Record<PlanType, string> = {
  holdings: "Direct hedge",
  costs: "Partial hedge — crude share only",
};

export class PlanInputError extends Error {}

function roundDownToStep(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const n = Math.floor(value / step + 1e-9) * step;
  return Number(n.toFixed(decimals));
}

function num(v: unknown, name: string, min: number, max: number): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  if (typeof n !== "number" || !isFinite(n)) throw new PlanInputError(`${name} must be a number`);
  if (n < min || n > max) throw new PlanInputError(`${name} must be between ${min} and ${max}`);
  return n;
}

/** Validate and normalise untrusted form input. Throws PlanInputError. */
export function parseInputs(type: PlanType, raw: Record<string, unknown>): PlanInputs {
  const leverage = num(raw.leverage ?? 1, "Leverage", 1, 3);
  const bufferPct = num(raw.bufferPct ?? 25, "Margin buffer", 0, 200);
  if (type === "holdings") {
    const h: HoldingsInputs = {
      asset: "ADA",
      amountHeld: Math.floor(num(raw.amountHeld, "Amount held", 1, 1e9)),
      sharePct: num(raw.sharePct ?? 100, "Share to protect", 10, 100),
      leverage,
      bufferPct,
    };
    return h;
  }
  const fuel: FuelType = isFuelType(raw.fuelType) ? raw.fuelType : "diesel";
  const currency = String(raw.currency ?? "NGN").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "NGN";
  const c: CostsInputs = {
    fuelType: fuel,
    litresPerMonth: num(raw.litresPerMonth, "Litres per month", 1, 1e8),
    pumpPrice: num(raw.pumpPrice, "Pump price", 0.0001, 1e9),
    fxRate: num(raw.fxRate, "Exchange rate", 0.0001, 1e9),
    currency,
    months: Math.round(num(raw.months ?? 3, "Months covered", 1, 6)),
    crudeSharePct: num(raw.crudeSharePct ?? 50, "Crude share", 0, 100),
    coverPct: Math.round(num(raw.coverPct ?? 100, "Share hedged", 1, 100)),
    leverage,
    bufferPct,
  };
  if (isCountry(raw.country)) c.country = raw.country;
  // Budget mode: the server works out the cover from the budget, never trusting a client figure.
  const b = raw.budget as { monthlyMax?: unknown; stressPct?: unknown } | null | undefined;
  if (b && b.monthlyMax != null && b.monthlyMax !== "") {
    const monthlyMax = num(b.monthlyMax, "Monthly budget", 0.01, 1e12);
    const stressPct = num(b.stressPct ?? 50, "Crude rise to protect against", 5, 200);
    const r = budgetCover(c, monthlyMax, stressPct);
    if (!r.ok && r.reason === "below_today") {
      throw new PlanInputError(`Your budget is below today's bill (${c.currency} ${Math.round(r.billNow).toLocaleString("en-US")} a month). A hedge can't lower today's price.`);
    }
    if (!r.ok) {
      throw new PlanInputError(`No hedge needed: even if crude rises ${stressPct}%, your bill stays under ${c.currency} ${Math.round(monthlyMax).toLocaleString("en-US")} a month.`);
    }
    c.coverPct = r.coverPct;
    c.budget = { monthlyMax, stressPct };
  }
  return c;
}

/** Crude-linked USD exposure of a costs plan over its whole term. */
export function costsExposureUsd(c: CostsInputs): number {
  return ((c.crudeSharePct / 100) * ((c.coverPct ?? 100) / 100) * c.litresPerMonth * c.months * c.pumpPrice) / c.fxRate;
}

export function sizePlan(
  type: PlanType,
  inputs: PlanInputs,
  price: number,
  rules: MarketRules,
  fees: FeeRates
): Sizing {
  if (!(price > 0)) throw new PlanInputError("No live price for this market");
  let rawSize: number;
  if (type === "holdings") {
    const h = inputs as HoldingsInputs;
    rawSize = (h.amountHeld * h.sharePct) / 100;
  } else {
    rawSize = costsExposureUsd(inputs as CostsInputs) / price;
  }
  const size = roundDownToStep(rawSize, rules.stepSize);
  const notional = size * price;
  if (size < rules.minQty || notional < rules.minNotional) {
    throw new PlanInputError(
      `This plan is too small to hedge: Strike's minimum order is $${rules.minNotional} on ${rules.symbol} (this plan is $${notional.toFixed(2)}).`
    );
  }
  const L = inputs.leverage;
  const b = inputs.bufferPct / 100;
  const initialMarginUsd = notional / L;
  const bufferMarginUsd = (notional * b) / L;
  const feeRate = fees.takerRate + fees.builderBps / 10_000;
  const openFeeUsd = notional * feeRate;
  const feesUsd = openFeeUsd * 2;
  const marginUsd = initialMarginUsd + bufferMarginUsd;
  return {
    symbol: rules.symbol,
    side: PLAN_SIDE[type],
    size,
    price,
    notional,
    leverage: L,
    bufferPct: inputs.bufferPct,
    initialMarginUsd,
    bufferMarginUsd,
    marginUsd,
    openFeeUsd,
    feesUsd,
    requiredUsd: marginUsd + feesUsd,
  };
}

export function signedSize(s: Pick<Sizing, "side" | "size">): number {
  return s.side === "sell" ? -s.size : s.size;
}

/** Value of a holdings plan at price P', with and without the hedge. */
export function holdingsOutcome(h: HoldingsInputs, hedgeSize: number, entry: number, price: number) {
  const without = h.amountHeld * price;
  const hedgePnl = hedgeSize * (entry - price);
  return { without, with: without + hedgePnl };
}

/**
 * Crude-share pump model: only the crude-linked share c of the pump price follows WTI.
 *   p' = p × (1 + c × (W'/W − 1))
 */
export function modelPumpPrice(c: CostsInputs, wtiEntry: number, wti: number): number {
  return c.pumpPrice * (1 + (c.crudeSharePct / 100) * (wti / wtiEntry - 1));
}

/** Monthly fuel bill (local currency) with and without the hedge, and effective price per litre. */
export function costsOutcome(c: CostsInputs, hedgeSize: number, wtiEntry: number, wti: number, extraUsd = 0) {
  const pump = modelPumpPrice(c, wtiEntry, wti);
  const without = c.litresPerMonth * pump;
  const hedgeGainLocal = (hedgeSize * (wti - wtiEntry) + extraUsd) * c.fxRate;
  const withHedge = without - hedgeGainLocal / c.months;
  return { without, with: withHedge, effectivePrice: withHedge / c.litresPerMonth, pump };
}

export function buildPreview(
  type: PlanType,
  inputs: PlanInputs,
  sizing: Sizing,
  rules: MarketRules,
  hourlyFundingRate: number
): Preview {
  const s = signedSize(sizing);
  const entry = sizing.price;
  const iso = sizing.marginUsd;
  const liq = liquidationPrice(rules.tiers, s, entry, iso);
  // Locke asks for a top-up at whichever comes first: its ratio level or 10% from liquidation.
  const byRatio = priceAtRatio(rules.tiers, s, entry, iso, LOCKE_THRESHOLDS.action);
  const byDistance = priceAtDistance(s, liq, DISTANCE_LEVELS.action);
  const alert =
    byRatio == null ? byDistance : byDistance == null ? byRatio : s < 0 ? Math.min(byRatio, byDistance) : Math.max(byRatio, byDistance);
  const liquidatedAt = (p: number) =>
    liq != null && (sizing.side === "sell" ? p >= liq : p <= liq);

  const scenarios: Scenario[] = SCENARIO_MOVES.map((move) => {
    const price = entry * (1 + move);
    if (type === "holdings") {
      const o = holdingsOutcome(inputs as HoldingsInputs, sizing.size, entry, price);
      return { move, price, without: o.without, with: o.with, liquidated: liquidatedAt(price) };
    }
    const o = costsOutcome(inputs as CostsInputs, sizing.size, entry, price);
    return { move, price, without: o.without, with: o.with, liquidated: liquidatedAt(price) };
  });

  let headline: number;
  let unit: string;
  if (type === "holdings") {
    const h = inputs as HoldingsInputs;
    headline = h.amountHeld * entry;
    unit = "USD";
  } else {
    const c = inputs as CostsInputs;
    headline = c.pumpPrice;
    unit = `${c.currency}/L`;
  }

  return {
    sizing,
    hourlyFundingRate,
    fundingPerDayUsd: fundingPerDay(s, entry, hourlyFundingRate),
    scenarios,
    alertPrice: alert,
    liquidationPrice: liq,
    label: PLAN_LABEL[type],
    headline,
    unit,
  };
}

export interface ReplayPoint {
  t: number;
  price: number;
  without: number;
  with: number;
  /** Funding to this day if today's rate had held (USD; + received, − paid). Shown separately, not in `with`. */
  funding: number;
}

/**
 * Replay a plan against daily closes, with the hedge rebased to the first close.
 * Strike publishes no funding-rate history, so the lines show price effects only and
 * funding at today's rate is carried alongside as a labelled projection.
 */
export function replay(
  type: PlanType,
  inputs: PlanInputs,
  hedgeSize: number,
  closes: { t: number; close: number }[],
  hourlyFundingRate: number
): ReplayPoint[] {
  if (closes.length === 0) return [];
  const p0 = closes[0].close;
  const s = PLAN_SIDE[type] === "sell" ? -hedgeSize : hedgeSize;
  let funding = 0;
  return closes.map(({ t, close }, i) => {
    if (i > 0) funding += fundingPerDay(s, close, hourlyFundingRate);
    if (type === "holdings") {
      const o = holdingsOutcome(inputs as HoldingsInputs, hedgeSize, p0, close);
      return { t, price: close, without: o.without, with: o.with, funding };
    }
    const o = costsOutcome(inputs as CostsInputs, hedgeSize, p0, close);
    return { t, price: close, without: o.without, with: o.with, funding };
  });
}

/** Headline number for a live plan: protected value (holdings) or effective fuel price (costs). */
export function liveHeadline(
  type: PlanType,
  inputs: PlanInputs,
  hedgeSize: number,
  entry: number,
  mark: number,
  fundingUsd: number
): number {
  if (type === "holdings") {
    return holdingsOutcome(inputs as HoldingsInputs, hedgeSize, entry, mark).with + fundingUsd;
  }
  return costsOutcome(inputs as CostsInputs, hedgeSize, entry, mark, fundingUsd).effectivePrice;
}
