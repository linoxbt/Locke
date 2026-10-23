// Shared domain types. Pure data, safe to import from browser, server and worker.

import type { CountryCode, FuelType } from "./fuel";
import type { FillEstimate } from "./liquidity";

export type PlanType = "holdings" | "costs";
export type Side = "buy" | "sell";

export type PlanStatus =
  | "draft"
  | "funding"
  | "opening"
  | "active"
  | "closing"
  | "closed"
  | "failed";

/** Risk level layered on top of an active plan (section 4.3 / 8.2 of the spec). */
export type RiskLevel = "ok" | "watch" | "action" | "margin_call" | "reduce_only" | "liquidation";

export interface HoldingsInputs {
  asset: "ADA";
  /** Q: ADA held by the business (whole ADA). */
  amountHeld: number;
  /** h: share of Q to protect, 10..100 (%). */
  sharePct: number;
  /** L: 1..3. */
  leverage: number;
  /** b: extra margin above the minimum, in % (default 25). */
  bufferPct: number;
}

export interface CostsInputs {
  fuelType: FuelType;
  /** Country the reference prices and calibration came from; absent for "other". */
  country?: CountryCode;
  /** V: litres per month. */
  litresPerMonth: number;
  /** p: pump price, local currency per litre. */
  pumpPrice: number;
  /** f: local currency per USD. */
  fxRate: number;
  /** ISO code shown next to local amounts, e.g. NGN. */
  currency: string;
  /** T: months covered, 1..6. */
  months: number;
  /** c: share of the pump price assumed to move with crude, 0..100 (%). */
  crudeSharePct: number;
  /** s: share of the crude-linked cost the hedge covers, 1..100 (%). Plans made before this field: 100. */
  coverPct?: number;
  /** Budget mode: keep the monthly bill under monthlyMax if crude rises stressPct. Sets coverPct. */
  budget?: { monthlyMax: number; stressPct: number } | null;
  leverage: number;
  bufferPct: number;
}

export type PlanInputs = HoldingsInputs | CostsInputs;

export interface MarginTier {
  max_notional: string;
  max_leverage: number;
  maintenance_margin_rate: string;
  maintenance_amount: string;
}

export interface MarketRules {
  symbol: string;
  stepSize: number;
  minQty: number;
  minNotional: number;
  tiers: MarginTier[];
}

export interface FeeRates {
  takerRate: number;
  builderBps: number;
}

export interface Sizing {
  symbol: string;
  side: Side;
  /** Hedge size in base units, already rounded to the market step. */
  size: number;
  /** Mark price used for sizing. */
  price: number;
  notional: number;
  leverage: number;
  bufferPct: number;
  /** Initial margin the engine reserves: notional / L. */
  initialMarginUsd: number;
  /** Extra isolated margin Locke adds after the fill: notional × b / L. */
  bufferMarginUsd: number;
  /** Total isolated margin target: notional × (1 + b) / L. */
  marginUsd: number;
  /** Taker + builder fee to open. */
  openFeeUsd: number;
  /** Fees to open plus to close later; deposited up front so closing never draws on margin. */
  feesUsd: number;
  /** marginUsd + feesUsd. */
  requiredUsd: number;
}

export interface Scenario {
  move: number;
  price: number;
  without: number;
  with: number;
  /** True when this move would liquidate the plan before the price got there (without top-ups). */
  liquidated: boolean;
}

export interface Preview {
  sizing: Sizing;
  fundingPerDayUsd: number;
  hourlyFundingRate: number;
  scenarios: Scenario[];
  alertPrice: number | null;
  liquidationPrice: number | null;
  /** Hedge quality label shown on the card. */
  label: string;
  /** Headline number at today's price: protected value (USD) or effective fuel price (local/litre). */
  headline: number;
  unit: string;
  /** Estimated market fill from Strike's order book at preview time; absent if the book was unavailable. */
  execution?: FillEstimate;
}
