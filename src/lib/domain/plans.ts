// Plan sizing, scenario preview and replay (spec sections 4 and 9).
// Pure functions: every price, rule and fee comes in as an argument.

import {
  fundingPerDay,
  liquidationPrice,
  LOCKE_THRESHOLDS,
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
  const fuel = raw.fuelType === "petrol" ? "petrol" : "diesel";
  const currency = String(raw.currency ?? "NGN").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "NGN";
  const c: CostsInputs = {
    fuelType: fuel,
    litresPerMonth: num(raw.litresPerMonth, "Litres per month", 1, 1e8),
    pumpPrice: num(raw.pumpPrice, "Pump price", 0.0001, 1e9),
    fxRate: num(raw.fxRate, "Exchange rate", 0.0001, 1e9),
    currency,
    months: Math.round(num(raw.months ?? 3, "Months covered", 1, 6)),
    crudeSharePct: num(raw.crudeSharePct ?? 50, "Crude share", 0, 100),
    leverage,
    bufferPct,
  };
  return c;
}

/** Crude-linked USD exposure of a costs plan over its whole term. */
export function costsExposureUsd(c: CostsInputs): number {
  return ((c.crudeSharePct / 100) * c.litresPerMonth * c.months * c.pumpPrice) / c.fxRate;
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
  const alert = priceAtRatio(rules.tiers, s, entry, iso, LOCKE_THRESHOLDS.action);
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
}

/**
 * Replay a plan against daily closes. The hedge is rebased to the first close;
 * funding uses today's rate as a constant (labelled on screen as an assumption).
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
  const side = PLAN_SIDE[type];
  const s = side === "sell" ? -hedgeSize : hedgeSize;
  const dailyFunding = fundingPerDay(s, p0, hourlyFundingRate);
  return closes.map(({ t, close }, i) => {
    const funding = dailyFunding * i;
    if (type === "holdings") {
      const o = holdingsOutcome(inputs as HoldingsInputs, hedgeSize, p0, close);
      return { t, price: close, without: o.without, with: o.with + funding };
    }
    const o = costsOutcome(inputs as CostsInputs, hedgeSize, p0, close, funding);
    return { t, price: close, without: o.without, with: o.with };
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
