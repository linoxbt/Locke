import { describe, expect, it } from "vitest";
import { nextFundingUsd, realizedFrom, withMark } from "@/lib/domain/live";
import type { PlanView } from "@/lib/server/planService";

const th = { watch: 0.5, action: 0.6, target: 0.4 } as PlanView["thresholds"];
const plan = (over: Partial<PlanView> = {}): PlanView =>
  ({
    status: "active",
    type: "holdings",
    side: "sell",
    symbol: "ADA-USD",
    inputs: { amountHeld: 62, sharePct: 100, leverage: 2, bufferPct: 25 },
    mark: 0.206,
    hourlyFundingRate: 0.0000125,
    position: { size: 62, entry: 0.206, isoBalance: 7.9, upnl: 0, maintenanceMargin: 0.13, liquidationPrice: 0.3314, fundingToDate: 0, leverage: 2 },
    ratio: 0.0165,
    liquidationDistance: 0.6,
    riskLevel: "ok",
    thresholds: th,
    headline: 12.772,
    fundingPerDay: 0,
    liveUnavailable: false,
    ...over,
  }) as PlanView;

describe("withMark", () => {
  it("moves the hedge result and keeps a holdings plan's protected value flat", () => {
    const p = withMark(plan(), { mark: 0.21, fundingRate: 0.0000125, nextFundingTime: null, at: 0 });
    expect(p.mark).toBe(0.21);
    expect(p.position!.upnl).toBeCloseTo(-62 * 0.004, 10); // short loses as ADA rises
    expect(p.headline).toBeCloseTo(62 * 0.206, 10); // ADA gain and hedge loss cancel
    expect(p.liquidationDistance).toBeCloseTo((0.3314 - 0.21) / 0.21, 10);
    expect(p.position!.maintenanceMargin).toBeCloseTo(0.13 * (0.21 / 0.206), 10);
    expect(p.ratio).toBeCloseTo(p.position!.maintenanceMargin / (7.9 - 62 * 0.004), 10);
  });
  it("gives a short positive funding when the rate is positive", () => {
    const p = withMark(plan(), { mark: 0.2, fundingRate: 0.0001, nextFundingTime: null, at: 0 });
    expect(p.fundingPerDay).toBeCloseTo(0.0001 * 24 * 62 * 0.2, 10);
    expect(nextFundingUsd(p)).toBeCloseTo(0.0001 * 62 * 0.2, 10);
  });
  it("leaves a plan alone without a live position or tick", () => {
    const base = plan({ status: "closed" });
    expect(withMark(base, { mark: 0.3, fundingRate: 0, nextFundingTime: null, at: 0 })).toBe(base);
    const active = plan();
    expect(withMark(active, null)).toBe(active);
    const stale = plan({ liveUnavailable: true });
    expect(withMark(stale, { mark: 0.3, fundingRate: 0, nextFundingTime: null, at: 0 })).toBe(stale);
  });
});

describe("realizedFrom", () => {
  const id = "c8f45b39-91d9-49be-834e-f24d51ff97d1";
  it("sums the plan's own fills and forced closes, leaving out funding rows and the user's own trades", () => {
    const fills = [
      // Strike's real opening fill for this plan.
      { realized_pnl: "0.000000000000000000", fee: "0.006386620000000000", fee_type: "commission", client_order_id: `locke-${id}-open-1`, auto_close_type: "", timestamp: 1_000 },
      { realized_pnl: "-0.25", fee: "0.0062", fee_type: "commission", client_order_id: `locke-${id}-close-1`, timestamp: 5_000 },
      { realized_pnl: "-1", fee: "0", fee_type: "liquidation", liquidation_fee: "0.05", client_order_id: "", auto_close_type: "LIQUIDATION", timestamp: 6_000 },
      { realized_pnl: "0", fee: "0.01", fee_type: "funding", client_order_id: `locke-${id}-open-1`, timestamp: 6_500 },
      { realized_pnl: "3", fee: "0.5", fee_type: "commission", client_order_id: "", auto_close_type: "", timestamp: 7_000 }, // placed by hand on Strike
      { realized_pnl: "4", fee: "0.5", fee_type: "commission", client_order_id: "locke-other-plan-open-1", timestamp: 7_500 },
      { realized_pnl: "9", fee: "1", fee_type: "commission", client_order_id: `locke-${id}-close-2`, timestamp: 99_000 }, // after the window
    ];
    const r = realizedFrom(fills, id, 1_000, 10_000);
    expect(r.pnl).toBeCloseTo(-1.25, 10);
    expect(r.fees).toBeCloseTo(0.00638662 + 0.0062 + 0.05 + 0.01 * 0, 10);
    expect(r.fills).toBe(4);
  });
});
