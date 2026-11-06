import { describe, expect, it } from "vitest";
import { protectLink, readPrefill } from "@/lib/base/prefill";

describe("Protect this position links", () => {
  it("fills a stock plan from a ticker, a token or a pair, with shares or value", () => {
    expect(readPrefill("?asset=nvda&value=5000&share=47&ref=o1", "stocks")).toEqual({ pairIndex: 81, valueUsd: 5000, sharePct: 45, ref: "o1" });
    expect(readPrefill("?token=NVDAc&shares=25", "stocks")).toEqual({ pairIndex: 81, units: 25 });
    expect(readPrefill("?symbol=US500/USD", "stocks")).toEqual({ pairIndex: 78 });
  });

  it("fills an oil plan and a crypto plan", () => {
    expect(readPrefill("?asset=BRENT&product=jet&monthly=12,000&months=3", "costs")).toEqual({ pairIndex: 97, product: "jet", monthlySpendUsd: 12000, months: 3 });
    expect(readPrefill("?asset=ETH&value=20000", "holdings")).toEqual({ pairIndex: 0, valueUsd: 20000 });
  });

  it("ignores what doesn't fit: another plan's market, out-of-range numbers, odd refs", () => {
    expect(readPrefill("?asset=ETH&value=-5&share=500&ref=<script>", "stocks")).toEqual({});
    expect(readPrefill("?asset=NVDA&product=gold&months=12", "costs")).toEqual({});
  });

  it("builds the link a partner puts on its button", () => {
    expect(protectLink("https://x.test/", "stocks", { asset: "NVDA", shares: 25, ref: "o1" })).toBe("https://x.test/protect/stocks?asset=NVDA&shares=25&ref=o1");
  });
});
