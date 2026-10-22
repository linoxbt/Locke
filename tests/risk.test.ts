import { describe, expect, it } from "vitest";
import {
  fundingPerDay,
  liquidationPrice,
  maintenanceMargin,
  marginRatio,
  priceAtRatio,
  riskLevel,
  suggestedTopUpUsd,
  LOCKE_THRESHOLDS,
} from "@/lib/domain/risk";
import type { MarginTier } from "@/lib/domain/types";

// ADA-USD tiers as served by GET /v2/markets (first three).
const tiers: MarginTier[] = [
  { max_notional: "10000", max_leverage: 40, maintenance_margin_rate: "0.005", maintenance_amount: "0" },
  { max_notional: "25000", max_leverage: 40, maintenance_margin_rate: "0.01", maintenance_amount: "50" },
  { max_notional: "50000", max_leverage: 25, maintenance_margin_rate: "0.01", maintenance_amount: "50" },
];

const ratioAt = (signed: number, entry: number, iso: number, mark: number) =>
  marginRatio(maintenanceMargin(tiers, signed, mark), iso, signed * (mark - entry));

describe("margin math", () => {
  it("short liquidation price puts the ratio at 100%", () => {
    const s = -1000, entry = 0.2, iso = 0.2 * 1000 * 1.25;
    const liq = liquidationPrice(tiers, s, entry, iso)!;
    expect(liq).toBeGreaterThan(entry);
    expect(ratioAt(s, entry, iso, liq)).toBeCloseTo(1, 6);
  });

  it("long liquidation price puts the ratio at 100%", () => {
    const s = 10, entry = 100, iso = (1000 * 1.25) / 3;
    const liq = liquidationPrice(tiers, s, entry, iso)!;
    expect(liq).toBeLessThan(entry);
    expect(ratioAt(s, entry, iso, liq)).toBeCloseTo(1, 6);
  });

  it("solves any target ratio and re-resolves tiers", () => {
    const s = -60000, entry = 0.2, iso = 12000 / 3; // notional crosses into tier 2 as price rises
    for (const t of [0.35, 0.5, 0.6, 0.7]) {
      const x = priceAtRatio(tiers, s, entry, iso, t)!;
      expect(ratioAt(s, entry, iso, x)).toBeCloseTo(t, 6);
    }
  });

  it("1x short with a 25% buffer cannot be liquidated below +80%", () => {
    const liq = liquidationPrice(tiers, -1000, 0.2, 250)!;
    expect(liq / 0.2 - 1).toBeGreaterThan(0.8);
  });

  it("applies hysteresis when leaving Watch", () => {
    expect(riskLevel(0.52, "ok")).toBe("watch");
    expect(riskLevel(0.47, "watch")).toBe("watch");
    expect(riskLevel(0.44, "watch")).toBe("ok");
    expect(riskLevel(0.47, "ok")).toBe("ok");
    expect(riskLevel(0.61, "ok")).toBe("action");
    expect(riskLevel(0.75, "ok")).toBe("margin_call");
    expect(riskLevel(0.95, "ok")).toBe("reduce_only");
    expect(riskLevel(1.2, "ok")).toBe("liquidation");
  });

  it("top-up brings the ratio back to target", () => {
    const mm = 30, iso = 40, upnl = -5;
    const add = suggestedTopUpUsd(mm, iso, upnl, LOCKE_THRESHOLDS.target);
    expect(marginRatio(mm, iso + add, upnl)).toBeCloseTo(LOCKE_THRESHOLDS.target, 9);
    expect(suggestedTopUpUsd(1, 100, 0, 0.35)).toBe(0);
  });

  it("longs pay and shorts receive when funding is positive", () => {
    expect(fundingPerDay(10, 100, 0.0001)).toBeCloseTo(-2.4);
    expect(fundingPerDay(-10, 100, 0.0001)).toBeCloseTo(2.4);
  });
});

import { combinedLevel, distanceToLiquidation, isoForLiquidationAt, priceAtDistance } from "@/lib/domain/risk";

describe("distance-based alerts", () => {
  it("alerts on a 1x plan well before the ratio would", () => {
    const s = -1000, entry = 0.2, iso = 250;
    const liq = liquidationPrice(tiers, s, entry, iso)!;
    const mark = liq / 1.08; // 8% from liquidation
    const ratio = ratioAt(s, entry, iso, mark);
    expect(ratio).toBeLessThan(0.1); // ratio alone says "ok"
    expect(combinedLevel(ratio, distanceToLiquidation(s, mark, liq), "ok")).toBe("action");
    expect(combinedLevel(ratio, distanceToLiquidation(s, liq / 1.15, liq), "ok")).toBe("watch");
    expect(combinedLevel(ratio, distanceToLiquidation(s, liq / 1.21, liq), "watch")).toBe("watch");
    expect(combinedLevel(ratio, distanceToLiquidation(s, liq / 1.3, liq), "watch")).toBe("ok");
  });

  it("finds the isolated balance for a target liquidation price", () => {
    for (const [s, entry] of [[-1000, 0.2], [10, 100]] as const) {
      const target = s < 0 ? entry * 1.6 : entry * 0.6;
      const iso = isoForLiquidationAt(tiers, s, entry, target);
      expect(liquidationPrice(tiers, s, entry, iso)).toBeCloseTo(target, 6);
      expect(priceAtDistance(s, target, 0.1)).toBeCloseTo(s < 0 ? target / 1.1 : target / 0.9, 9);
    }
  });
});
