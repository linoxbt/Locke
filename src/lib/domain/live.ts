// A plan's numbers moved to a fresh mark price, between server reads.
// Pure, so the browser can run it on every price tick and tests can check it.

import { liveHeadline } from "./plans";
import { combinedLevel, distanceToLiquidation, fundingPerDay, marginRatio, unrealisedPnl } from "./risk";
import type { PlanView } from "../server/planService";

export interface MarkTick {
  mark: number;
  /** Hourly funding rate, the same field the server reads (`r`). */
  fundingRate: number;
  /** Next funding settlement, Unix ms. */
  nextFundingTime: number | null;
  /** When this tick arrived, Unix ms. */
  at: number;
}

/**
 * Re-derive everything that follows the mark: hedge result, headline, margin ratio, distance to
 * liquidation, risk level and funding per day. Balances, entry and liquidation price stay as the
 * server last read them; maintenance margin scales with the mark (same tier between reads).
 */
export function withMark(p: PlanView, tick: MarkTick | null): PlanView {
  if (!tick || !(tick.mark > 0) || p.liveUnavailable || p.status !== "active" || !p.position) return p;
  const pos = p.position;
  const signed = p.side === "sell" ? -pos.size : pos.size;
  const mark = tick.mark;
  const upnl = unrealisedPnl(signed, pos.entry, mark);
  const mm = p.mark > 0 ? pos.maintenanceMargin * (mark / p.mark) : pos.maintenanceMargin;
  let ratio = marginRatio(mm, pos.isoBalance, upnl);
  if (!isFinite(ratio)) ratio = 1;
  const distance = distanceToLiquidation(signed, mark, pos.liquidationPrice);
  return {
    ...p,
    mark,
    hourlyFundingRate: tick.fundingRate,
    position: { ...pos, upnl, maintenanceMargin: mm },
    ratio,
    liquidationDistance: distance,
    riskLevel: combinedLevel(ratio, distance, p.riskLevel, p.thresholds),
    headline: liveHeadline(p.type, p.inputs, pos.size, pos.entry, mark, pos.fundingToDate),
    fundingPerDay: fundingPerDay(signed, mark, tick.fundingRate),
  };
}

/** Funding the position receives (+) or pays (−) at the next hourly settlement, at this mark and rate. */
export function nextFundingUsd(p: PlanView): number {
  if (!p.position) return 0;
  return p.fundingPerDay / 24;
}
