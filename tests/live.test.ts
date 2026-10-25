import { describe, expect, it } from "vitest";
import { nextFundingUsd, withMark } from "@/lib/domain/live";
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
