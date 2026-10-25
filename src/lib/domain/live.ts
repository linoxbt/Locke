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

/** What a plan's own fills on Strike have realized so far. */
export interface Realized {
  /** Realized P&L from reducing or closing the position (opening realizes nothing). */
  pnl: number;
  /** Trading fees paid on the plan's fills (commission and liquidation fees). */
  fees: number;
  fills: number;
}

/**
 * Sum the plan's fills: its own orders (Locke's client order id) and Strike's forced closes
 * (liquidation, ADL) inside its window. Trades a user places on Strike themselves are left out.
 * Strike's `fee` is a cost; funding rows are left out because funding comes from the position's total.
 */
export function realizedFrom(
  fills: {
    realized_pnl?: string;
    fee?: string;
    fee_type?: string;
    liquidation_fee?: string;
    client_order_id?: string;
    auto_close_type?: string;
    timestamp: number;
  }[],
  planId: string,
  fromMs: number,
  toMs: number | null
): Realized {
  const mine = `locke-${planId}-`;
  let pnl = 0;
  let fees = 0;
  let n = 0;
  for (const f of fills) {
    if (f.timestamp < fromMs || (toMs != null && f.timestamp > toMs)) continue;
    const ours = f.client_order_id ? f.client_order_id.startsWith(mine) : !!f.auto_close_type;
    if (!ours) continue;
    n++;
    pnl += parseFloat(f.realized_pnl ?? "0") || 0;
    if ((f.fee_type ?? "").toLowerCase() !== "funding") fees += parseFloat(f.fee ?? "0") || 0;
    fees += parseFloat(f.liquidation_fee ?? "0") || 0;
  }
  return { pnl, fees, fills: n };
}

/** Funding the position receives (+) or pays (−) at the next hourly settlement, at this mark and rate. */
export function nextFundingUsd(p: PlanView): number {
  if (!p.position) return 0;
  return p.fundingPerDay / 24;
}
