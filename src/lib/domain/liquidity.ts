// Execution estimate: walk Strike's visible order book for a market order of a given size.
// Pure, so the preview, the open guard and the tests share one implementation.

import type { Side } from "./types";

/** [price, quantity in base units]. */
export type BookLevel = [number, number];

export interface OrderBook {
  bids: BookLevel[];
  asks: BookLevel[];
}

export interface FillEstimate {
  /** Volume-weighted average price over the part the book can fill; null if nothing fills. */
  avgPrice: number | null;
  /** Adverse move of the average fill against the mark (0.001 = 0.1%); negative is in your favour. */
  slippage: number | null;
  /** Price of the last level the order reaches. */
  worstPrice: number | null;
  /** Share of the size the visible book can fill (1 = all of it). */
  fillable: number;
  /** Price levels the order walks through. */
  levels: number;
}

/** Locke shows a caution above this and refuses to send the order above MAX_SLIPPAGE. */
export const WARN_SLIPPAGE = 0.003;
export const MAX_SLIPPAGE = 0.01;

export function estimateFill(book: OrderBook, side: Side, size: number, mark: number): FillEstimate {
  // A buy lifts the asks from the cheapest up; a sell hits the bids from the highest down.
  const levels = [...(side === "buy" ? book.asks : book.bids)]
    .filter(([p, q]) => p > 0 && q > 0)
    .sort((a, b) => (side === "buy" ? a[0] - b[0] : b[0] - a[0]));
  let left = size;
  let cost = 0;
  let worst: number | null = null;
  let used = 0;
  for (const [price, qty] of levels) {
    if (left <= 0) break;
    const take = Math.min(left, qty);
    cost += take * price;
    left -= take;
    worst = price;
    used++;
  }
  const filled = size - Math.max(0, left);
  if (filled <= 0) return { avgPrice: null, slippage: null, worstPrice: null, fillable: 0, levels: 0 };
  const avg = cost / filled;
  const slippage = side === "buy" ? avg / mark - 1 : 1 - avg / mark;
  return { avgPrice: avg, slippage, worstPrice: worst, fillable: Math.min(1, filled / size), levels: used };
}

/** Why an order shouldn't be sent at market right now, or null when the book can take it. */
export function fillProblem(est: FillEstimate): string | null {
  if (est.fillable < 1) {
    return `Strike's order book can only fill ${(est.fillable * 100).toFixed(0)}% of this size right now. Try a smaller plan or try again shortly.`;
  }
  if (est.slippage != null && est.slippage > MAX_SLIPPAGE) {
    return `Filling this size now would cost about ${(est.slippage * 100).toFixed(2)}% over the mark price. Try a smaller plan or try again shortly.`;
  }
  return null;
}
