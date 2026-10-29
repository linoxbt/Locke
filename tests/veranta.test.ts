import { afterEach, describe, expect, it, vi } from "vitest";
import snapshot from "./fixtures/veranta-trading.json";
import {
  LIQ_LOSS_SHARE,
  parseMarkets,
  parsePosition,
  tradable,
  verantaCarryPerDay,
  verantaLiquidationPrice,
  verantaMarginRatio,
  verantaPnl,
  verantaTopUpUsd,
  type RawTradingSnapshot,
} from "@/lib/domain/veranta";
import { getMarket, getPositions, getSignedPrice } from "@/lib/veranta/client";

// A real ETH short from Veranta's core API (29 Oct 2026): $1,999.32 at 4.0x, opened at 2,323.10.
const ETH_SHORT = {
  liquidationPrice: "28166368358560",
  rolloverFee: "0",
  unrealisedFundingFee: "-142878",
  pairIndex: 0,
  index: 5,
  buy: false,
  collateral: "1999320013",
  leverage: "40012845458",
  openPrice: "23230959388129",
  openedAt: 1793279467,
  coinExposure: "34436151071",
};

describe("Veranta markets", () => {
  const markets = parseMarkets(snapshot as unknown as RawTradingSnapshot);
  const by = (s: string) => markets.find((m) => m.symbol === s)!;

  it("reads WTI as a live $10-minimum oil market priced by Pyth Lazer", () => {
    const wti = by("WTI/USD");
    expect(wti).toMatchObject({ index: 96, group: "COMMODITIES", listed: true, minPositionUsd: 10, maxLeverage: 25, openFeePct: 0.1, closeFeePct: 0, lazerFeedId: 3455 });
    expect(tradable(wti)).toBe(true);
    expect(wti.carryPctPerHour.long).toBeCloseTo(0.0002853, 10);
  });

  it("keeps the delisted USOILSPOT market out of trading", () => {
    const spot = by("USOILSPOT/USD");
    expect(spot.listed).toBe(false);
    expect(tradable(spot)).toBe(false);
  });

  it("adds funding and borrow into one carry per side", () => {
    const eth = by("ETH/USD");
    expect(eth.minPositionUsd).toBe(100);
    expect(eth.carryPctPerHour.short).toBeLessThan(0); // shorts are paid today
    // $1,000 of long WTI costs about 0.0003% an hour: under 7 cents a day.
    expect(verantaCarryPerDay(by("WTI/USD"), true, 1000)).toBeCloseTo(0.0685, 3);
  });
});

describe("Veranta positions and risk", () => {
  const p = parsePosition(ETH_SHORT);

  it("parses Veranta's raw scales", () => {
    expect(p.collateralUsd).toBeCloseTo(1999.32, 2);
    expect(p.leverage).toBeCloseTo(4.0013, 4);
    expect(p.openPrice).toBeCloseTo(2323.096, 3);
    expect(p.signedSize).toBeCloseTo(-3.4436, 4);
    expect(p.fundingFeeUsd).toBeCloseTo(-0.142878, 6); // being paid
  });

  it("matches Veranta's own liquidation price", () => {
    expect(verantaLiquidationPrice(p)).toBeCloseTo(p.liquidationPrice, 1); // 2,816.64
  });

  it("puts the margin ratio at 100% exactly at liquidation", () => {
    const liq = verantaLiquidationPrice(p);
    expect(verantaMarginRatio(p, liq)).toBeCloseTo(1, 3);
    expect(verantaMarginRatio(p, p.openPrice)).toBeCloseTo((1 - LIQ_LOSS_SHARE) * p.collateralUsd / (p.collateralUsd - p.fundingFeeUsd), 6);
    expect(verantaMarginRatio(p, liq * 1.01)).toBeGreaterThan(1); // past liquidation for a short
    expect(verantaMarginRatio(p, liq * 0.99)).toBeLessThan(1);
  });

  it("sizes a top-up that brings the ratio back to the target", () => {
    const mark = 2700; // a 16% rally against the short
    const before = verantaMarginRatio(p, mark);
    expect(before).toBeCloseTo(0.427, 3); // $300 of maintenance against $701 of equity
    const add = verantaTopUpUsd(p, mark, 0.3);
    const after = verantaMarginRatio({ ...p, collateralUsd: p.collateralUsd + add }, mark);
    expect(after).toBeLessThanOrEqual(0.3);
    expect(after).toBeGreaterThan(0.299);
    expect(verantaTopUpUsd(p, p.openPrice, 0.3)).toBe(0); // healthy: nothing to add
    expect(() => verantaTopUpUsd(p, mark, 0.1)).toThrow();
  });

  it("gives P&L in USD from the signed size", () => {
    expect(verantaPnl(p, 2300)).toBeCloseTo(3.4436 * 23.096, 1);
  });
});

describe("Veranta client", () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

  it("reads a market by symbol from the catalogue", async () => {
    vi.stubGlobal("fetch", respond(snapshot));
    expect((await getMarket("wti/usd")).index).toBe(96);
    await expect(getMarket("ADA/USD")).rejects.toThrow("no market");
  });

  it("reads a vault's positions and refuses a non-address", async () => {
    const f = respond({ positions: [ETH_SHORT], limitOrders: [] });
    vi.stubGlobal("fetch", f);
    const [pos] = await getPositions("0x66d5d2Ef1a9855eCb7817732d87b5f230Fc0DBC4");
    expect(pos.buy).toBe(false);
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain("/core/user-data?trader=0x66d5");
    await expect(getPositions("0xnope")).rejects.toThrow("Not an address");
  });

  it("returns null for a price while the market is closed, and errors on a bad status", async () => {
    vi.stubGlobal("fetch", respond({ core: null, pro: null }));
    expect(await getSignedPrice(96)).toBeNull();
    vi.stubGlobal("fetch", respond({ pro: { priceUpdateData: "0xab", price: 100.9, publishTimestampMs: 1 } }));
    expect(await getSignedPrice(96)).toEqual({ price: 100.9, updateData: "0xab", publishedAt: 1 });
    vi.stubGlobal("fetch", respond({ message: "down" }, 503));
    await expect(getSignedPrice(96)).rejects.toThrow("failed (503)");
  });
});
