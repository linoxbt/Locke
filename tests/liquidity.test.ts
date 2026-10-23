import { describe, expect, it } from "vitest";
import { estimateFill, fillProblem, MAX_SLIPPAGE } from "@/lib/domain/liquidity";

const book = {
  bids: [
    [0.2119, 1000],
    [0.212, 500],
    [0.2115, 5000],
  ] as [number, number][],
  asks: [
    [0.2125, 2000],
    [0.2121, 500],
    [0.213, 5000],
  ] as [number, number][],
};

describe("estimateFill", () => {
  it("walks the asks from the cheapest for a buy", () => {
    const est = estimateFill(book, "buy", 1500, 0.212);
    // 500 @ 0.2121 + 1000 @ 0.2125
    expect(est.avgPrice).toBeCloseTo((500 * 0.2121 + 1000 * 0.2125) / 1500, 10);
    expect(est.worstPrice).toBe(0.2125);
    expect(est.levels).toBe(2);
    expect(est.fillable).toBe(1);
    expect(est.slippage).toBeGreaterThan(0);
  });

  it("walks the bids from the highest for a sell", () => {
    const est = estimateFill(book, "sell", 1200, 0.212);
    // 500 @ 0.2120 + 700 @ 0.2119
    expect(est.avgPrice).toBeCloseTo((500 * 0.212 + 700 * 0.2119) / 1200, 10);
    expect(est.worstPrice).toBe(0.2119);
    expect(est.slippage).toBeCloseTo(1 - est.avgPrice! / 0.212, 12);
  });

  it("reports a partial fill when the book is too thin", () => {
    const est = estimateFill(book, "sell", 10_000, 0.212);
    expect(est.fillable).toBeCloseTo(6500 / 10_000, 10);
    expect(fillProblem(est)).toMatch(/only fill 65%/);
  });

  it("flags slippage beyond the limit and passes a normal fill", () => {
    const deep = estimateFill(book, "buy", 7500, 0.2);
    expect(deep.slippage!).toBeGreaterThan(MAX_SLIPPAGE);
    expect(fillProblem(deep)).toMatch(/over the mark/);
    expect(fillProblem(estimateFill(book, "buy", 400, 0.2121))).toBeNull();
  });

  it("handles an empty side", () => {
    const est = estimateFill({ bids: [], asks: [] }, "buy", 10, 1);
    expect(est).toEqual({ avgPrice: null, slippage: null, worstPrice: null, fillable: 0, levels: 0 });
    expect(fillProblem(est)).not.toBeNull();
  });
});
