import { describe, expect, it } from "vitest";
import { ACTION_EXIT_FACTOR, LOCKE_THRESHOLDS, riskLevel } from "@/lib/domain/risk";

describe("action hysteresis", () => {
  it("doesn't flap between watch and action around the action level", () => {
    expect(riskLevel(0.61, "watch")).toBe("action");
    expect(riskLevel(0.59, "action")).toBe("action");
    expect(riskLevel(LOCKE_THRESHOLDS.action * ACTION_EXIT_FACTOR - 0.001, "action")).toBe("watch");
    expect(riskLevel(0.59, "watch")).toBe("watch");
    expect(riskLevel(0.46, "watch")).toBe("watch");
    expect(riskLevel(0.44, "watch")).toBe("ok");
  });
});

describe("exchange-level hysteresis", () => {
  it("holds a level until the ratio is clearly below it, so alerts don't flap", () => {
    expect(riskLevel(0.705, "action")).toBe("margin_call");
    expect(riskLevel(0.695, "margin_call")).toBe("margin_call");
    expect(riskLevel(0.66, "margin_call")).toBe("action");
    expect(riskLevel(0.88, "reduce_only")).toBe("reduce_only");
    expect(riskLevel(0.84, "reduce_only")).toBe("margin_call");
    expect(riskLevel(0.97, "liquidation")).toBe("liquidation");
    expect(riskLevel(0.94, "liquidation")).toBe("reduce_only");
    expect(riskLevel(0.695, "action")).toBe("action");
  });
});
