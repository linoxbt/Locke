// Margin and liquidation math for one isolated position.
// Strike defines margin ratio as maintenance margin / margin balance, where an
// isolated margin balance is the position's isolated balance plus uPnL.

import type { MarginTier, RiskLevel } from "./types";

const DEFAULT_MMR = 0.01;

/** First tier whose max_notional >= notional; above the last tier, the last tier. */
export function tierFor(tiers: MarginTier[], notional: number): MarginTier | undefined {
  if (!tiers?.length) return undefined;
  for (const t of tiers) if (parseFloat(t.max_notional) >= notional) return t;
  return tiers[tiers.length - 1];
}

export function mmrFor(tiers: MarginTier[], notional: number): { mmr: number; ma: number } {
  const t = tierFor(tiers, notional);
  return t
    ? { mmr: parseFloat(t.maintenance_margin_rate), ma: parseFloat(t.maintenance_amount) }
    : { mmr: DEFAULT_MMR, ma: 0 };
}

export function maintenanceMargin(tiers: MarginTier[], size: number, mark: number): number {
  const notional = Math.abs(size) * mark;
  const { mmr, ma } = mmrFor(tiers, notional);
  return Math.max(0, notional * mmr - ma);
}

/** Signed size: positive long, negative short. */
export function unrealisedPnl(signedSize: number, entry: number, mark: number): number {
  return signedSize * (mark - entry);
}

/** Margin ratio as a fraction (0.7 = 70%). Infinity when the margin balance is gone. */
export function marginRatio(mm: number, isoBalance: number, upnl: number): number {
  const bal = isoBalance + upnl;
  if (bal <= 0) return Infinity;
  return mm / bal;
}

/**
 * Price at which the position's margin ratio reaches `target`.
 * Solves  |s|·X·mmr − ma = t·(iso + s·(X − E))  for X, re-resolving the margin tier
 * at the solved notional (a few fixed-point passes are enough for tiered MMR).
 */
export function priceAtRatio(
  tiers: MarginTier[],
  signedSize: number,
  entry: number,
  isoBalance: number,
  target: number
): number | null {
  const q = Math.abs(signedSize);
  if (q === 0 || target <= 0) return null;
  let x = entry;
  for (let i = 0; i < 5; i++) {
    const { mmr, ma } = mmrFor(tiers, q * x);
    let next: number;
    if (signedSize < 0) {
      next = (target * (isoBalance + q * entry) + ma) / (q * (mmr + target));
    } else {
      const denom = q * (target - mmr);
      if (denom <= 0) return null;
      next = (target * (q * entry - isoBalance) - ma) / denom;
    }
    if (!isFinite(next)) return null;
    if (Math.abs(next - x) < 1e-12) {
      x = next;
      break;
    }
    x = next;
  }
  return x > 0 ? x : null;
}

/** Estimated liquidation price: margin ratio reaches 100%. */
export function liquidationPrice(
  tiers: MarginTier[],
  signedSize: number,
  entry: number,
  isoBalance: number
): number | null {
  return priceAtRatio(tiers, signedSize, entry, isoBalance, 1);
}

export interface Thresholds {
  watch: number;
  action: number;
  /** A plan leaves Watch only when R falls below this. */
  watchExit: number;
  /** Top-ups aim to bring R back to this. */
  target: number;
}

/** Locke's own levels sit below Strike's 70% margin call because a Cardano deposit needs confirmations. */
export const LOCKE_THRESHOLDS: Thresholds = { watch: 0.5, action: 0.6, watchExit: 0.45, target: 0.35 };

/** Strike's own levels. */
export const STRIKE_LEVELS = { marginCall: 0.7, reduceOnly: 0.9, liquidation: 1 };

/**
 * Demo setting: alert levels scaled down so the alert and top-up flow can be shown
 * without waiting for a real price move. Always labelled on screen.
 */
export const DEMO_THRESHOLDS: Thresholds = {
  watch: 0.002,
  action: 0.003,
  watchExit: 0.0015,
  target: 0.0025,
};

/** Leaving Action takes a ratio this far below the Action level, so a ratio hovering at it doesn't flap. */
export const ACTION_EXIT_FACTOR = 0.92;

/**
 * Risk level with hysteresis: once at Watch or worse, leave only below watchExit; once at Action
 * or worse, step down to Watch only below action × ACTION_EXIT_FACTOR.
 */
export function riskLevel(ratio: number, prev: RiskLevel, th: Thresholds = LOCKE_THRESHOLDS): RiskLevel {
  if (ratio >= STRIKE_LEVELS.liquidation) return "liquidation";
  if (ratio >= STRIKE_LEVELS.reduceOnly) return "reduce_only";
  if (ratio >= STRIKE_LEVELS.marginCall) return "margin_call";
  if (ratio >= th.action) return "action";
  if (LEVEL_RANK[prev] >= LEVEL_RANK.action && ratio >= th.action * ACTION_EXIT_FACTOR) return "action";
  if (ratio >= th.watch) return "watch";
  if (prev !== "ok" && ratio >= th.watchExit) return "watch";
  return "ok";
}

export const LEVEL_RANK: Record<RiskLevel, number> = {
  ok: 0,
  watch: 1,
  action: 2,
  margin_call: 3,
  reduce_only: 4,
  liquidation: 5,
};

/**
 * Margin ratio only climbs steeply in the last few percent before liquidation, so on a
 * low-leverage plan a ratio alert alone would fire too late for a Cardano deposit to land.
 * Locke therefore also alerts on how far the mark is from the liquidation price.
 */
export const DISTANCE_LEVELS = { watch: 0.2, action: 0.1, actionExit: 0.12, watchExit: 0.22, target: 0.25 };

/** Fractional distance from mark to liquidation in the adverse direction (0.1 = 10%). */
export function distanceToLiquidation(signedSize: number, mark: number, liq: number | null): number | null {
  if (liq == null || !(mark > 0)) return null;
  return signedSize < 0 ? (liq - mark) / mark : (mark - liq) / mark;
}

/** Mark price at which the distance to liquidation equals `d`. */
export function priceAtDistance(signedSize: number, liq: number | null, d: number): number | null {
  if (liq == null) return null;
  return signedSize < 0 ? liq / (1 + d) : liq / (1 - d);
}

/** Isolated balance that would put the liquidation price at `x`. */
export function isoForLiquidationAt(tiers: MarginTier[], signedSize: number, entry: number, x: number): number {
  const q = Math.abs(signedSize);
  const { mmr, ma } = mmrFor(tiers, q * x);
  return signedSize < 0 ? x * q * (1 + mmr) - q * entry - ma : q * entry - ma - x * q * (1 - mmr);
}

/** Worse of the ratio level and the distance level, each with its own hysteresis. */
export function combinedLevel(
  ratio: number,
  distance: number | null,
  prev: RiskLevel,
  th: Thresholds = LOCKE_THRESHOLDS
): RiskLevel {
  const byRatio = riskLevel(ratio, prev, th);
  let byDistance: RiskLevel = "ok";
  if (distance != null) {
    if (distance <= 0) byDistance = "liquidation";
    else if (distance <= DISTANCE_LEVELS.action) byDistance = "action";
    else if (LEVEL_RANK[prev] >= LEVEL_RANK.action && distance <= DISTANCE_LEVELS.actionExit) byDistance = "action";
    else if (distance <= DISTANCE_LEVELS.watch) byDistance = "watch";
    else if (prev !== "ok" && distance <= DISTANCE_LEVELS.watchExit) byDistance = "watch";
  }
  return LEVEL_RANK[byDistance] > LEVEL_RANK[byRatio] ? byDistance : byRatio;
}

/** USD to add so the ratio returns to `target`. */
export function suggestedTopUpUsd(mm: number, isoBalance: number, upnl: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, mm / target - (isoBalance + upnl));
}

/**
 * Funding received (+) or paid (−) per day at an hourly rate.
 * Funding settles hourly; when the rate is positive, longs pay shorts.
 */
export function fundingPerDay(signedSize: number, mark: number, hourlyRate: number): number {
  return -Math.sign(signedSize) * hourlyRate * 24 * Math.abs(signedSize) * mark;
}
