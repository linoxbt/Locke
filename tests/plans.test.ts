import { describe, expect, it } from "vitest";
import { buildPreview, costsOutcome, parseInputs, PlanInputError, replay, sizePlan } from "@/lib/domain/plans";
import type { CostsInputs, HoldingsInputs, MarketRules } from "@/lib/domain/types";

const ada: MarketRules = {
  symbol: "ADA-USD", stepSize: 1, minQty: 1, minNotional: 10,
  tiers: [{ max_notional: "10000", max_leverage: 40, maintenance_margin_rate: "0.005", maintenance_amount: "0" }],
};
const wti: MarketRules = {
  symbol: "WTI-USD", stepSize: 0.01, minQty: 0.01, minNotional: 10,
  tiers: [{ max_notional: "50000", max_leverage: 20, maintenance_margin_rate: "0.005", maintenance_amount: "0" }],
};
const fees = { takerRate: 0.0005, builderBps: 5 };

describe("holdings plan", () => {
  const h = parseInputs("holdings", { amountHeld: 10000, sharePct: 60, leverage: 1, bufferPct: 25 }) as HoldingsInputs;

  it("sizes a short in whole ADA with margin (1 + b) / L", () => {
    const s = sizePlan("holdings", h, 0.21, ada, fees);
    expect(s.side).toBe("sell");
    expect(s.size).toBe(6000);
    expect(s.notional).toBeCloseTo(1260);
    expect(s.marginUsd).toBeCloseTo(1260 * 1.25);
    expect(s.openFeeUsd).toBeCloseTo(1260 * 0.001);
  });

  it("protects the hedged share exactly in every scenario", () => {
    const full = parseInputs("holdings", { amountHeld: 10000, sharePct: 100 }) as HoldingsInputs;
    const s = sizePlan("holdings", full, 0.2, ada, fees);
    const p = buildPreview("holdings", full, s, ada, 0);
    for (const sc of p.scenarios) expect(sc.with).toBeCloseTo(2000, 6);
    expect(p.scenarios.find((x) => x.move === 0.5)!.liquidated).toBe(false);
  });

  it("refuses plans under Strike's minimum notional", () => {
    const tiny = parseInputs("holdings", { amountHeld: 40, sharePct: 100 }) as HoldingsInputs;
    expect(() => sizePlan("holdings", tiny, 0.2, ada, fees)).toThrow(PlanInputError);
  });

  it("validates form ranges", () => {
    expect(() => parseInputs("holdings", { amountHeld: 100, sharePct: 5 })).toThrow(PlanInputError);
    expect(() => parseInputs("holdings", { amountHeld: 100, leverage: 5 })).toThrow(PlanInputError);
    expect(() => parseInputs("holdings", { amountHeld: "abc" })).toThrow(PlanInputError);
  });
});

describe("operating costs plan", () => {
  const c = parseInputs("costs", {
    fuelType: "diesel", litresPerMonth: 2000, pumpPrice: 1200, fxRate: 1500, currency: "ngn",
    months: 3, crudeSharePct: 50, leverage: 1, bufferPct: 25,
  }) as CostsInputs;

  it("sizes a long on the crude-linked share", () => {
    // exposure = 0.5 × 2000 × 3 × 1200 / 1500 = $2400 → 2400 / 80 = 30 WTI
    const s = sizePlan("costs", c, 80, wti, fees);
    expect(s.side).toBe("buy");
    expect(s.size).toBe(30);
    expect(c.currency).toBe("NGN");
  });

  it("holds the effective fuel price when crude share is 100%", () => {
    const all = { ...c, crudeSharePct: 100 };
    const s = sizePlan("costs", all, 80, wti, fees);
    for (const w of [40, 60, 100, 120]) {
      expect(costsOutcome(all, s.size, 80, w).effectivePrice).toBeCloseTo(1200, 1);
    }
  });

  it("replays against closes, rebased to the first", () => {
    const s = sizePlan("costs", c, 80, wti, fees);
    const pts = replay("costs", c, s.size, [{ t: 1, close: 80 }, { t: 2, close: 100 }], 0);
    expect(pts[0].with).toBeCloseTo(pts[0].without);
    expect(pts[1].without).toBeGreaterThan(pts[0].without);
    expect(pts[1].with).toBeCloseTo(pts[0].with, 0);
  });
});

describe("input checks added after the second audit", () => {
  it("refuses fractional leverage, an empty budget, and orders above Strike's maximum", async () => {
    const { parseInputs, sizePlan, PlanInputError } = await import("@/lib/domain/plans");
    expect(() => parseInputs("holdings", { amountHeld: 1000, leverage: 1.5 })).toThrow(PlanInputError);
    const costs = { litresPerMonth: 1000, pumpPrice: 1000, fxRate: 1500, currency: "NGN", months: 3, crudeSharePct: 50 };
    expect(() => parseInputs("costs", { ...costs, budget: { monthlyMax: null, stressPct: 50 } })).toThrow(/monthly budget/);
    expect(() => parseInputs("costs", { ...costs, budget: { monthlyMax: "", stressPct: 50 } })).toThrow(/monthly budget/);
    expect((parseInputs("costs", costs) as { coverPct: number }).coverPct).toBe(100);
    const rules = { symbol: "WTI-USD", stepSize: 0.01, minQty: 0.01, minNotional: 10, maxQty: 500, tiers: [] };
    const fees = { takerRate: 0.0005, builderBps: 5 };
    const big = parseInputs("costs", { ...costs, litresPerMonth: 1_000_000, crudeSharePct: 100, months: 6 });
    expect(() => sizePlan("costs", big, 100, rules, fees)).toThrow(/larger than Strike takes/);
  });
});
