// Sizing for Locke on Base. Pure functions, shared by the form, the server and the keeper.
//
// A plan hedges a notional N on one Veranta market at leverage L:
//   holdings: N = value held × share protected        (short ETH or BTC)
//   costs:    N = monthly spend on crude or an oil product × months × crude share   (long WTI or Brent)
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

/**
 * What a business buys whose price follows crude, with the share of its price that typically moves
 * with crude (the rest is refining, transport, taxes and margins). A starting point: the business
 * sets its own share.
 */
export const OIL_PRODUCTS = [
  { id: "crude", label: "Crude oil", share: 100, hint: "Crude bought at a price set off WTI or Brent moves almost one for one with it." },
  { id: "diesel", label: "Diesel", share: 60, hint: "About 60% of a diesel price follows crude; refining, transport, taxes and margins make up the rest." },
  { id: "petrol", label: "Petrol", share: 50, hint: "About half of a pump price follows crude; taxes and margins make up much of the rest." },
  { id: "jet", label: "Jet fuel", share: 65, hint: "Jet fuel follows crude closely, apart from refining margins and delivery." },
  { id: "marine", label: "Marine fuel", share: 75, hint: "Bunker and marine fuels are mostly crude, with refining and port costs on top." },
  { id: "heating", label: "Heating oil", share: 60, hint: "About 60% of a heating oil price follows crude." },
  { id: "lpg", label: "LPG and propane", share: 40, hint: "LPG follows crude only in part: gas markets and seasons move it too." },
  { id: "asphalt", label: "Asphalt", share: 50, hint: "Asphalt and bitumen follow crude for about half their price." },
  { id: "petrochemicals", label: "Plastics and chemicals", share: 35, hint: "Plastics, resins and other petrochemicals follow crude for part of their cost." },
] as const;
export type OilProduct = (typeof OIL_PRODUCTS)[number]["id"];
export const oilProduct = (id: string | undefined) => OIL_PRODUCTS.find((p) => p.id === id);

export interface CostsInputs {
  type: "costs";
  pairIndex: number;
  /** What the business buys (crude, diesel, jet fuel…). Plans made before this field say fuel. */
  product?: OilProduct;
  /** Spent on it each month, USD. */
  monthlySpendUsd: number;
  /** Months covered, 1–6. */
  months: number;
  /** Share of its price that moves with crude, 10–100 (%). */
  crudeSharePct: number;
  leverage: number;
  bufferPct: number;
}

/** Stocks a business holds (tokenized on Base or not), hedged with a short on Veranta's equity market. */
export interface StocksInputs {
  type: "stocks";
  pairIndex: number;
  /** Value of the shares held, USD. */
  valueUsd: number;
  /** Share of it to protect, 10–100 (%). */
  sharePct: number;
  leverage: number;
  bufferPct: number;
}

export type BasePlanInputs = HoldingsInputs | CostsInputs | StocksInputs;

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
  /** On-chain limits (the keeper can never trade beyond them): the keeper's open is capped at maxNotionalUsd, the hedge's margin (top-ups included) at maxCollateralUsd. */
  limits: { maxLeverage: number; maxNotionalUsd: number; maxCollateralUsd: number };
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
  if (type === "holdings" || type === "stocks") {
    between(n("valueUsd"), 1, 10_000_000, "Value held");
    between(n("sharePct"), 10, 100, "Share protected");
    return { type, pairIndex: market.pairIndex, valueUsd: n("valueUsd"), sharePct: n("sharePct"), leverage: n("leverage"), bufferPct: n("bufferPct") };
  }
  const product = r.product == null || r.product === "" ? undefined : oilProduct(String(r.product))?.id;
  if (r.product != null && r.product !== "" && !product) throw new BasePlanError(`Product must be one of ${OIL_PRODUCTS.map((p) => p.id).join(", ")}`);
  between(n("monthlySpendUsd"), 1, 10_000_000, "Monthly spend");
  between(n("months"), 1, 6, "Months");
  between(n("crudeSharePct"), 10, 100, "Crude share");
  return {
    type,
    pairIndex: market.pairIndex,
    ...(product ? { product } : {}),
    monthlySpendUsd: n("monthlySpendUsd"),
    months: n("months"),
    crudeSharePct: n("crudeSharePct"),
    leverage: n("leverage"),
    bufferPct: n("bufferPct"),
  };
}

export function hedgeNotional(i: BasePlanInputs): number {
  return i.type === "costs" ? (i.monthlySpendUsd * i.months * i.crudeSharePct) / 100 : (i.valueUsd * i.sharePct) / 100;
}

/**
 * The vault's on-chain limits. They depend on the inputs only (not on fees or prices), so the
 * server can check a created vault against what the business asked for.
 */
export function planLimits(i: BasePlanInputs): BaseSizing["limits"] {
  const notional = hedgeNotional(i);
  const collateral = notional / i.leverage;
  // The margin may grow by the whole buffer through top-ups, whatever the leverage; the open stays
  // capped near the hedge's own size.
  return {
    maxLeverage: i.leverage,
    maxNotionalUsd: ceilCents(notional * NOTIONAL_HEADROOM),
    maxCollateralUsd: ceilCents(Math.max(collateral * NOTIONAL_HEADROOM, collateral * (1 + i.bufferPct / 100))),
  };
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
  if (i.type === "stocks") return m?.asset === "US500" || m?.asset === "US100" ? `${m.label} protection` : `${m?.label ?? "Stock"} stock protection`;
  if (i.type === "holdings") return `${m?.asset ?? "Treasury"} treasury protection`;
  const what = oilProduct(i.product)?.label.toLowerCase() ?? "fuel";
  return `${i.months}-month ${what} cover (${m?.asset === "BRENT" ? "Brent" : (m?.asset ?? "oil")})`;
}
