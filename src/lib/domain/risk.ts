// Risk levels for a hedge's margin ratio (how much of the margin a move has used up: 1 = liquidated).

import type { RiskLevel } from "./types";

export interface Thresholds {
  watch: number;
  action: number;
  /** A hedge leaves Watch only when the ratio falls below this. */
  watchExit: number;
  /** Top-ups aim to bring the ratio back to this. */
  target: number;
}

/** Locke acts well before the exchange's own levels, so a top-up lands in time. */
export const LOCKE_THRESHOLDS: Thresholds = { watch: 0.5, action: 0.6, watchExit: 0.45, target: 0.35 };

/** The levels past Locke's own: close to a margin call, close to reduce-only, and liquidation. */
export const EXCHANGE_LEVELS = { marginCall: 0.7, reduceOnly: 0.9, liquidation: 1 };

/** Leaving Action takes a ratio this far below the Action level, so a ratio hovering at it doesn't flap. */
export const ACTION_EXIT_FACTOR = 0.92;
/** Leaving one of the exchange levels takes a ratio this far below it. */
export const EXCHANGE_EXIT_FACTOR = 0.95;

export const LEVEL_RANK: Record<RiskLevel, number> = {
  ok: 0,
  watch: 1,
  action: 2,
  margin_call: 3,
  reduce_only: 4,
  liquidation: 5,
};

/**
 * Risk level with hysteresis: once at Watch or worse, leave only below watchExit; once at Action
 * or worse, step down to Watch only below action × ACTION_EXIT_FACTOR; the exchange levels step
 * down only below level × EXCHANGE_EXIT_FACTOR.
 */
export function riskLevel(ratio: number, prev: RiskLevel, th: Thresholds = LOCKE_THRESHOLDS): RiskLevel {
  const holds = (level: RiskLevel, at: number) => ratio >= at || (LEVEL_RANK[prev] >= LEVEL_RANK[level] && ratio >= at * EXCHANGE_EXIT_FACTOR);
  if (holds("liquidation", EXCHANGE_LEVELS.liquidation)) return "liquidation";
  if (holds("reduce_only", EXCHANGE_LEVELS.reduceOnly)) return "reduce_only";
  if (holds("margin_call", EXCHANGE_LEVELS.marginCall)) return "margin_call";
  if (ratio >= th.action) return "action";
  if (LEVEL_RANK[prev] >= LEVEL_RANK.action && ratio >= th.action * ACTION_EXIT_FACTOR) return "action";
  if (ratio >= th.watch) return "watch";
  if (prev !== "ok" && ratio >= th.watchExit) return "watch";
  return "ok";
}
