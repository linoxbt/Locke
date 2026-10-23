import { describe, expect, it } from "vitest";
import { budgetCover, calibratedCrudeShare, crudeCostPerLitre, fxBillImpact, LITRES_PER_BARREL, PUMP_PRICES } from "@/lib/domain/fuel";
import { costsExposureUsd, costsOutcome, parseInputs, PlanInputError } from "@/lib/domain/plans";
import type { CostsInputs } from "@/lib/domain/types";

const base = { litresPerMonth: 2000, pumpPrice: 1790.25, crudeSharePct: 46 };

describe("crude-share calibration", () => {
  it("is crude's cost in a litre over the pump price", () => {
    const cost = crudeCostPerLitre("diesel", 100, 1332);
    expect(cost).toBeCloseTo((100 / LITRES_PER_BARREL) * 1332, 6);
    expect(calibratedCrudeShare("diesel", 100, 1332, 1790.25)).toBe(Math.round((100 * cost) / 1790.25));
  });

  it("counts LPG by energy content and stays within 5–95%", () => {
    expect(crudeCostPerLitre("lpg", 100, 1)).toBeCloseTo(crudeCostPerLitre("diesel", 100, 1) * 0.67, 9);
    expect(calibratedCrudeShare("diesel", 100, 1332, 1)).toBe(95);
    expect(calibratedCrudeShare("diesel", 1, 1, 1e6)).toBe(5);
    expect(calibratedCrudeShare("diesel", 0, 1332, 100)).toBeNull();
  });

  it("has a dated reference for every listed price", () => {
    for (const fuels of Object.values(PUMP_PRICES)) {
      for (const r of Object.values(fuels)) {
        expect(r!.price).toBeGreaterThan(0);
        expect(r!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});

describe("budget mode", () => {
  const bill = base.litresPerMonth * base.pumpPrice;

  it("finds the smallest cover that keeps the stressed bill on budget", () => {
    const r = budgetCover(base, bill * 1.1, 50);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Unhedged at +50%: bill × (1 + 0.46 × 0.5) = 1.23 × bill. Cover s keeps it at 1.1 × bill.
    const s = r.coverPct / 100;
    expect(bill * (1 + 0.46 * 0.5 * (1 - s))).toBeLessThanOrEqual(bill * 1.1 + 1e-6);
    expect(bill * (1 + 0.46 * 0.5 * (1 - (r.coverPct - 1) / 100))).toBeGreaterThan(bill * 1.1);
  });

  it("matches the plan's own outcome model at the stress price", () => {
    const c: CostsInputs = { ...base, fuelType: "diesel", fxRate: 1332, currency: "NGN", months: 3, leverage: 1, bufferPct: 25, coverPct: 100 };
    const r = budgetCover(c, bill * 1.1, 50);
    if (!r.ok) throw new Error("expected a cover");
    const sized = { ...c, coverPct: r.coverPct };
    const wti = 100;
    const size = costsExposureUsd(sized) / wti;
    const o = costsOutcome(sized, size, wti, wti * 1.5);
    expect(o.with).toBeLessThanOrEqual(bill * 1.1 + 1);
  });

  it("refuses a budget below today's bill and says when no hedge is needed", () => {
    expect(budgetCover(base, bill * 0.9, 50)).toMatchObject({ ok: false, reason: "below_today" });
    expect(budgetCover(base, bill * 2, 50)).toMatchObject({ ok: false, reason: "no_hedge_needed" });
  });

  it("is recomputed on the server from the budget, not taken from the client", () => {
    const raw = {
      fuelType: "kerosene",
      country: "KE",
      litresPerMonth: 1000,
      pumpPrice: 218.55,
      fxRate: 129.8,
      currency: "KES",
      months: 3,
      crudeSharePct: 36,
      coverPct: 100,
      budget: { monthlyMax: 1000 * 218.55 * 1.05, stressPct: 50 },
    };
    const c = parseInputs("costs", raw) as CostsInputs;
    expect(c.fuelType).toBe("kerosene");
    expect(c.country).toBe("KE");
    expect(c.coverPct).toBeLessThan(100);
    expect(c.budget).toEqual({ monthlyMax: raw.budget.monthlyMax, stressPct: 50 });
    expect(() => parseInputs("costs", { ...raw, budget: { monthlyMax: 1, stressPct: 50 } })).toThrow(PlanInputError);
  });

  it("sizes the hedge on the covered share only", () => {
    const c: CostsInputs = { ...base, fuelType: "diesel", fxRate: 1332, currency: "NGN", months: 3, leverage: 1, bufferPct: 25 };
    expect(costsExposureUsd({ ...c, coverPct: 40 })).toBeCloseTo(costsExposureUsd(c) * 0.4, 6);
  });
});

describe("exchange-rate exposure", () => {
  it("moves the crude-linked part of the bill with the currency", () => {
    expect(fxBillImpact(base, 10)).toBeCloseTo(2000 * 1790.25 * 0.46 * 0.1, 6);
  });
});
