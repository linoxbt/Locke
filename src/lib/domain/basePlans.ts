// Sizing for Locke on Base. Pure functions, shared by the form, the server and the keeper.
//
// A plan hedges a notional N on one Veranta market at leverage L:
//   holdings: N = value held × share protected        (short ETH or BTC)
//   costs:    N = monthly fuel spend × months × crude share   (long WTI or Brent)
// The vault is funded with the hedge's collateral N / L, a buffer kept idle in the vault for
// top-ups (b% of the collateral), and the trading fees to open and close.

import { baseMarket, type BasePlanType } from "../base/contracts";

export class BasePlanError extends Error {}

export interface HoldingsInputs {
  type: "holdings";
  pairIndex: number;
  /** Value of the holding, USD. */
  valueUsd: number;
  /** Share of it to protect, 10–100 (%). */
  sharePct: number;
  leverage: number;
  /** Idle margin kept in the vault for top-ups, % of the collateral (10–100). */
  bufferPct: number;
}

export interface CostsInputs {
  type: "costs";
  pairIndex: number;
  /** Fuel bought each month, USD. */
  monthlySpendUsd: number;
  /** Months covered, 1–6. */
  months: number;
  /** Share of the fuel price that moves with crude, 10–100 (%). */
  crudeSharePct: number;
  leverage: number;
  bufferPct: number;
}

export type BasePlanInputs = HoldingsInputs | CostsInputs;

/** What the sizing needs from Veranta's market data (fees in % of notional). */
export interface MarketTerms {
  minPositionUsd: number;
  maxLeverage: number;
  openFeePct: number;
  closeFeePct: number;
  spreadPct: number;
}

export interface BaseSizing {
  pairIndex: number;
  buy: boolean;
  notionalUsd: number;
  leverage: number;
  collateralUsd: number;
  bufferUsd: number;
  feesUsd: number;
  /** What the business deposits: collateral + buffer + fees, rounded up to the cent. */
  depositUsd: number;
  /** The vault's on-chain limits: the keeper can never trade beyond them. */
  limits: { maxLeverage: number; maxNotionalUsd: number };
}

/** Room above today's notional for the keeper to re-hedge after prices move (on-chain cap). */
export const NOTIONAL_HEADROOM = 1.1;
/** Locke on Base keeps leverage low: a hedge, not a trade. */
export const MAX_BASE_LEVERAGE = 3;

/** Round up to the cent, ignoring float noise (900 × 1.1 is 990.0000000000001, which must stay $990). */
const ceilCents = (usd: number) => Math.ceil(Number((usd * 100).toFixed(6))) / 100;

const between = (v: number, lo: number, hi: number, what: string) => {
  if (!Number.isFinite(v) || v < lo || v > hi) throw new BasePlanError(`${what} must be between ${lo} and ${hi}`);
};

/** Check the inputs a form or request sent, and return them typed. */
export function parseBaseInputs(raw: unknown): BasePlanInputs {
  const r = (raw ?? {}) as Record<string, unknown>;
  const n = (k: string) => Number(r[k]);
  const type = r.type as BasePlanType;
  const market = baseMarket(n("pairIndex"));
  if (!market || market.type !== type) throw new BasePlanError("Pick a market for this plan type");
  between(n("leverage"), 1, MAX_BASE_LEVERAGE, "Leverage");
  between(n("bufferPct"), 10, 100, "Buffer");
  if (type === "holdings") {
    between(n("valueUsd"), 1, 10_000_000, "Value held");
    between(n("sharePct"), 10, 100, "Share protected");
    return { type, pairIndex: market.pairIndex, valueUsd: n("valueUsd"), sharePct: n("sharePct"), leverage: n("leverage"), bufferPct: n("bufferPct") };
  }
  between(n("monthlySpendUsd"), 1, 10_000_000, "Monthly fuel spend");
  between(n("months"), 1, 6, "Months");
  between(n("crudeSharePct"), 10, 100, "Crude share");
  return {
    type,
    pairIndex: market.pairIndex,
    monthlySpendUsd: n("monthlySpendUsd"),
    months: n("months"),
    crudeSharePct: n("crudeSharePct"),
    leverage: n("leverage"),
    bufferPct: n("bufferPct"),
  };
}

export function hedgeNotional(i: BasePlanInputs): number {
  return i.type === "holdings" ? (i.valueUsd * i.sharePct) / 100 : (i.monthlySpendUsd * i.months * i.crudeSharePct) / 100;
}

/**
 * The vault's on-chain limits. They depend on the inputs only (not on fees or prices), so the
 * server can check a created vault against what the business asked for.
 */
export function planLimits(i: BasePlanInputs): BaseSizing["limits"] {
  return { maxLeverage: i.leverage, maxNotionalUsd: ceilCents(hedgeNotional(i) * NOTIONAL_HEADROOM) };
}

export function sizeBasePlan(i: BasePlanInputs, m: MarketTerms): BaseSizing {
  const market = baseMarket(i.pairIndex);
  if (!market) throw new BasePlanError("Unknown market");
  const notionalUsd = hedgeNotional(i);
  if (notionalUsd < m.minPositionUsd) {
    throw new BasePlanError(`Veranta's smallest ${market.asset} hedge is $${m.minPositionUsd}; this plan hedges $${notionalUsd.toFixed(2)}`);
  }
  if (i.leverage > m.maxLeverage) throw new BasePlanError(`${market.asset} allows at most ${m.maxLeverage}x`);
  const collateralUsd = notionalUsd / i.leverage;
  const bufferUsd = (collateralUsd * i.bufferPct) / 100;
  const feesUsd = (notionalUsd * (m.openFeePct + m.closeFeePct + 2 * m.spreadPct)) / 100;
  const depositUsd = ceilCents(collateralUsd + bufferUsd + feesUsd);
  return { pairIndex: i.pairIndex, buy: market.buy, notionalUsd, leverage: i.leverage, collateralUsd, bufferUsd, feesUsd, depositUsd, limits: planLimits(i) };
}

export function planName(i: BasePlanInputs): string {
  const m = baseMarket(i.pairIndex);
  return i.type === "holdings" ? `${m?.asset ?? "Treasury"} treasury protection` : `${i.months}-month fuel cover (${m?.asset ?? "oil"})`;
}
