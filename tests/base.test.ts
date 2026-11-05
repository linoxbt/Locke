import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { toFunctionSignature, toEventSignature, type AbiFunction, type AbiEvent } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

vi.mock("@/lib/server/baseChain", () => ({ basePublicClient: () => ({ verifyMessage: async () => false }) }));

import { builderSuffix } from "@/lib/base/builderCode";
import { factoryAbi, vaultAbi } from "@/lib/base/contracts";
import { decide, OPEN_RETRY_S, TOP_UP_RETRY_S, type VaultState } from "@/lib/base/keeper";
import { BasePlanError, parseBaseInputs, planLimits, planName, sizeBasePlan, type MarketTerms } from "@/lib/domain/basePlans";
import { verantaMarginRatio, type VerantaPosition } from "@/lib/domain/veranta";
import { HttpError } from "@/lib/server/errors";
import { checkSiweMessage, signatureMatches } from "@/lib/server/siwe";

const ETH_TERMS: MarketTerms = { minPositionUsd: 100, maxLeverage: 50, openFeePct: 0.045, closeFeePct: 0.045, spreadPct: 0.01 };
const WTI_TERMS: MarketTerms = { minPositionUsd: 10, maxLeverage: 25, openFeePct: 0.1, closeFeePct: 0, spreadPct: 0.06 };

describe("Base plan sizing", () => {
  it("sizes a holdings plan: hedge, margin, buffer, fees and on-chain limits", () => {
    const i = parseBaseInputs({ type: "holdings", pairIndex: 0, valueUsd: 1000, sharePct: 50, leverage: 2, bufferPct: 50 });
    const s = sizeBasePlan(i, ETH_TERMS);
    expect(s).toMatchObject({ buy: false, notionalUsd: 500, collateralUsd: 250, bufferUsd: 125 });
    expect(s.feesUsd).toBeCloseTo(0.55, 6); // (0.045 + 0.045 + 2×0.01)% of $500
    expect(s.depositUsd).toBe(375.55);
    expect(s.limits).toEqual({ maxLeverage: 2, maxNotionalUsd: 550, maxCollateralUsd: 375 });
  });

  it("sizes a costs plan long on oil", () => {
    const i = parseBaseInputs({ type: "costs", pairIndex: 96, monthlySpendUsd: 500, months: 3, crudeSharePct: 60, leverage: 1, bufferPct: 25 });
    const s = sizeBasePlan(i, WTI_TERMS);
    expect(s).toMatchObject({ buy: true, notionalUsd: 900, collateralUsd: 900, bufferUsd: 225 });
    expect(planLimits(i)).toEqual({ maxLeverage: 1, maxNotionalUsd: 990, maxCollateralUsd: 1125 }); // $900 margin + the 25% buffer
  });

  it("refuses what Veranta or Locke won't take", () => {
    expect(() => parseBaseInputs({ type: "holdings", pairIndex: 96, valueUsd: 1000, sharePct: 50, leverage: 2, bufferPct: 50 })).toThrow(BasePlanError);
    expect(() => parseBaseInputs({ type: "holdings", pairIndex: 0, valueUsd: 1000, sharePct: 50, leverage: 4, bufferPct: 50 })).toThrow("Leverage");
    expect(() => parseBaseInputs({ type: "costs", pairIndex: 97, monthlySpendUsd: 100, months: 9, crudeSharePct: 60, leverage: 1, bufferPct: 25 })).toThrow("Months");
    const small = parseBaseInputs({ type: "holdings", pairIndex: 0, valueUsd: 150, sharePct: 50, leverage: 1, bufferPct: 25 });
    expect(() => sizeBasePlan(small, ETH_TERMS)).toThrow("smallest ETH hedge is $100");
  });
});

describe("Base keeper decisions", () => {
  const sizing = sizeBasePlan(parseBaseInputs({ type: "holdings", pairIndex: 0, valueUsd: 1000, sharePct: 50, leverage: 2, bufferPct: 50 }), ETH_TERMS);
  const base: VaultState = {
    status: "funding",
    sizing,
    prevLevel: "ok",
    idleUsd: sizing.depositUsd,
    planEnabled: true,
    maxLeverage: 2,
    maxNotionalUsd: 550,
    maxCollateralUsd: sizing.limits.maxCollateralUsd,
    position: null,
    mark: 2300,
    marketOpen: true,
    closeOnly: false,
    paused: false,
    keeperIsUs: true,
    cooldownLeftS: 0,
    openSentAgoS: null,
    chainTrades: 0,
    goneRounds: 1,
    topUpSentAgoS: null,
    topUpCooldownLeftS: 0,
  };
  // A $500 ETH short at 2x opened at 2,300.
  const short: VerantaPosition = {
    pairIndex: 0, index: 0, buy: false, collateralUsd: 250, leverage: 2, openPrice: 2300, signedSize: -500 / 2300,
    notionalAtOpen: 500, rolloverFeeUsd: 0, fundingFeeUsd: 0, liquidationPrice: 2300 * 1.425, openedAt: 0,
  };

  it("won't open when the plan on Base is off, lowered below the hedge, or the market is close-only", () => {
    expect(decide({ ...base, planEnabled: false }).action).toMatchObject({ kind: "wait", note: expect.stringContaining("turned off") });
    expect(decide({ ...base, maxLeverage: 1.5 }).action).toMatchObject({ kind: "wait", note: expect.stringContaining("limits on Base") });
    expect(decide({ ...base, maxNotionalUsd: 400 }).action).toMatchObject({ kind: "wait", note: expect.stringContaining("limits on Base") });
    expect(decide({ ...base, maxCollateralUsd: 200 }).action).toMatchObject({ kind: "wait", note: expect.stringContaining("limits on Base") });
    expect(decide({ ...base, closeOnly: true }).action).toMatchObject({ kind: "wait", note: expect.stringContaining("new positions") });
  });

  it("sizes the margin cap to the whole buffer, at any leverage", () => {
    const one = sizeBasePlan(parseBaseInputs({ type: "holdings", pairIndex: 0, valueUsd: 1000, sharePct: 50, leverage: 1, bufferPct: 50 }), ETH_TERMS);
    expect(one.limits.maxNotionalUsd).toBe(550);
    expect(one.limits.maxCollateralUsd).toBe(750); // $500 margin + the $250 buffer
    expect(sizing.limits.maxCollateralUsd).toBe(375); // $250 margin + $125 buffer at 2x
  });

  it("opens the hedge once the deposit is in", () => {
    expect(decide(base).action).toEqual({ kind: "open", collateralUsd: 250, leverage: 2 });
    expect(decide(base).status).toBe("opening");
  });

  it("waits for the deposit, the market, the pause, the cooldown and a fill in flight", () => {
    expect(decide({ ...base, idleUsd: 100 }).action).toMatchObject({ kind: "wait", note: expect.stringContaining("Waiting for the deposit") });
    expect(decide({ ...base, marketOpen: false }).action).toMatchObject({ kind: "wait", note: expect.stringContaining("market is closed") });
    expect(decide({ ...base, paused: true }).action.kind).toBe("wait");
    expect(decide({ ...base, cooldownLeftS: 1800 }).action).toMatchObject({ kind: "wait", note: expect.stringContaining("30 min") });
    expect(decide({ ...base, status: "opening", openSentAgoS: 30 }).action).toMatchObject({ kind: "wait", note: "Waiting for Veranta to fill the hedge." });
    expect(decide({ ...base, status: "opening", openSentAgoS: OPEN_RETRY_S + 1 }).action.kind).toBe("open");
    expect(decide({ ...base, keeperIsUs: false }).action).toMatchObject({ kind: "wait", note: expect.stringContaining("removed") });
  });

  it("marks a filled hedge active and leaves a healthy one alone", () => {
    const d = decide({ ...base, status: "opening", position: short, idleUsd: 125, chainTrades: 1, goneRounds: 0 });
    expect(d.status).toBe("active");
    expect(d.level).toBe("ok");
    expect(d.action).toEqual({ kind: "wait", note: null });
  });

  it("adds margin from the buffer when margin use reaches the action level, back to the target", () => {
    const mark = 3200; // ETH up 39%: the short loses about $196 of its $250
    expect(verantaMarginRatio(short, mark)).toBeGreaterThan(0.6);
    const d = decide({ ...base, status: "active", position: short, idleUsd: 125, mark, chainTrades: 1, goneRounds: 0 });
    expect(d.action.kind).toBe("topUp");
    const amount = (d.action as { amountUsd: number }).amountUsd;
    expect(verantaMarginRatio({ ...short, collateralUsd: 250 + amount }, mark)).toBeLessThanOrEqual(0.351);
  });

  it("asks the owner for funds when the buffer is spent, and respects the plan's cap", () => {
    const mark = 3200;
    expect(decide({ ...base, status: "active", position: short, idleUsd: 0, mark, chainTrades: 1, goneRounds: 0 }).action.kind).toBe("needFunds");
    const capped = decide({ ...base, status: "active", position: short, idleUsd: 125, mark, maxCollateralUsd: 250, chainTrades: 1, goneRounds: 0 });
    expect(capped.action).toMatchObject({ kind: "wait", note: expect.stringContaining("limit is reached") });
  });

  it("never sends a second top-up while the first is still applying", () => {
    const thin = { ...base, status: "active" as const, position: short, idleUsd: 125, mark: 3200, chainTrades: 1, goneRounds: 0 };
    expect(decide({ ...thin, topUpSentAgoS: 20 }).action).toMatchObject({ kind: "wait", note: expect.stringContaining("waiting for it to apply") });
    expect(decide({ ...thin, topUpSentAgoS: TOP_UP_RETRY_S + 1 }).action.kind).toBe("topUp");
    // The vault's own two-minute spacing: wait for it rather than fail every round.
    expect(decide({ ...thin, topUpCooldownLeftS: 40 }).action).toMatchObject({ kind: "wait", note: expect.stringContaining("just added") });
    // Thin margin still adds margin on a close-only market.
    expect(decide({ ...thin, closeOnly: true }).action.kind).toBe("topUp");
  });

  it("waits instead of acting on incomplete figures", () => {
    const d = decide({ ...base, status: "active", position: { ...short, collateralUsd: NaN }, mark: 2300, chainTrades: 1, goneRounds: 0 });
    expect(d.action).toMatchObject({ kind: "wait", note: expect.stringContaining("incomplete") });
  });

  it("marks the vault closed only when Base shows no trade on two looks in a row", () => {
    expect(decide({ ...base, status: "active", goneRounds: 1 })).toMatchObject({ status: "active", action: { kind: "wait" } });
    expect(decide({ ...base, status: "active", goneRounds: 2 })).toMatchObject({ status: "closed", action: { kind: "closed" } });
  });

  it("never closes a vault whose hedge is still on Base, whatever the API says", () => {
    // The API answered without the position (lag, outage, changed shape): still open on Base.
    const d = decide({ ...base, status: "active", position: null, chainTrades: 1, goneRounds: 0 });
    expect(d).toMatchObject({ status: "active", action: { kind: "wait", note: expect.stringContaining("still open on Base") } });
    // A pending open order counts too: no second open while one is in flight.
    expect(decide({ ...base, status: "funding", chainTrades: 1, goneRounds: 0 })).toMatchObject({ status: "opening", action: { kind: "wait" } });
    // The API still shows a position Base no longer has: no top-up into a closed trade.
    expect(decide({ ...base, status: "active", position: short, mark: 3200, idleUsd: 125, chainTrades: 0, goneRounds: 1 }).action.kind).toBe("wait");
  });

  it("caps margin use when equity is gone, so it can be stored and shown", () => {
    const d = decide({ ...base, status: "active", position: { ...short, collateralUsd: 1 }, mark: 4600, idleUsd: 0, chainTrades: 1, goneRounds: 0 });
    expect(Number.isFinite(d.ratio)).toBe(true);
  });
});

describe("Sign in with Base", () => {
  const acct = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const now = Date.parse("2026-10-29T15:00:00Z");
  const msg = (over: Partial<Parameters<typeof createSiweMessage>[0]> = {}) =>
    createSiweMessage({
      domain: "trylocke.online",
      address: acct.address,
      statement: "Sign in to Locke on Base.",
      uri: "https://trylocke.online",
      version: "1",
      chainId: 8453,
      nonce: "a1b2c3d4e5f60718",
      issuedAt: new Date(now - 30_000),
      ...over,
    });

  it("accepts a fresh message for this site on Base", () => {
    expect(checkSiweMessage(msg(), { host: "trylocke.online", now })).toEqual({ address: acct.address, nonce: "a1b2c3d4e5f60718", partial: false });
  });

  it("reads a wallet's message with a multi-line statement or Windows line endings", () => {
    const multi = msg().replace("Sign in to Locke on Base.", "Sign in to Locke.\nThis request will not trigger a transaction.");
    expect(checkSiweMessage(multi, { host: "trylocke.online", now })).toEqual({ address: acct.address, nonce: "a1b2c3d4e5f60718", partial: false });
    expect(checkSiweMessage(msg().replace(/\n/g, "\r\n"), { host: "trylocke.online", now }).nonce).toBe("a1b2c3d4e5f60718");
    // Coinbase Wallet's own message: no Version and no Issued At (as logged on the preview).
    const coinbase = `trylocke.online wants you to sign in with your Ethereum account:\n${acct.address}\n\nURI: https://trylocke.online\nChain ID: 8453\nNonce: a1b2c3d4e5f60718`;
    expect(checkSiweMessage(coinbase, { host: "trylocke.online", now })).toEqual({ address: acct.address, nonce: "a1b2c3d4e5f60718", partial: true });
    expect(() => checkSiweMessage(coinbase.replace("Chain ID: 8453", "Chain ID: 1"), { host: "trylocke.online", now })).toThrow(/Base/);
    expect(() => checkSiweMessage(`${coinbase}\nNonce: ffffffffffffffff`, { host: "trylocke.online", now })).toThrow(/Invalid/);
    expect(() => checkSiweMessage(coinbase.replace("URI: https://trylocke.online\n", ""), { host: "trylocke.online", now })).toThrow(/Invalid/);
    // Other shapes wallets write: a URI with no scheme, a CAIP chain id, a space for the T.
    const loose = coinbase.replace("URI: https://", "URI: ").replace("Chain ID: 8453", "Chain ID: eip155:8453") + `\nIssued At: 2026-10-29 14:59:30Z`;
    expect(checkSiweMessage(loose, { host: "trylocke.online", now }).nonce).toBe("a1b2c3d4e5f60718");
    expect(() => checkSiweMessage(loose.replace("URI: trylocke.online", "URI: evil.example"), { host: "trylocke.online", now })).toThrow(/another site/);
    const evil = multi.replace("trylocke.online wants", "evil.example wants");
    expect(() => checkSiweMessage(evil, { host: "trylocke.online", now })).toThrow(/another site/);
  });

  it("refuses another site, another chain, or an old message", () => {
    const bad = (m: string) => {
      try {
        checkSiweMessage(m, { host: "trylocke.online", now });
      } catch (e) {
        return e instanceof HttpError ? e.message : String(e);
      }
      return "accepted";
    };
    expect(bad(msg({ domain: "evil.example" }))).toMatch(/another site/);
    expect(bad(msg({ uri: "https://evil.example" }))).toMatch(/another site/);
    expect(bad(msg({ chainId: 1 }))).toMatch(/Base/);
    expect(bad(msg({ issuedAt: new Date(now - 11 * 60_000) }))).toMatch(/expired/);
    expect(bad(msg({ expirationTime: new Date(now - 1000) }))).toMatch(/expired/);
  });

  it("checks an ordinary wallet's signature locally", async () => {
    const m = msg();
    const sig = await acct.signMessage({ message: m });
    expect(await signatureMatches(acct.address, m, sig)).toBe("wallet");
    const other = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
    expect(await signatureMatches(acct.address, m, await other.signMessage({ message: m }))).toBe(false);
  });
});

describe("Base contracts and Builder Codes", () => {
  it("appends an ERC-8021 suffix ending in the 8021 marker, and nothing without a code", () => {
    expect(builderSuffix("bc_locke123")).toMatch(/80218021802180218021802180218021$/);
    expect(builderSuffix(null)).toBeUndefined();
  });

  const artifact = (name: string) => path.join(__dirname, "..", "contracts", "artifacts", "src", `${name}.sol`, `${name}.json`);
  const compiled = existsSync(artifact("LockeVault")) && existsSync(artifact("LockeVaultFactory"));

  it.skipIf(!compiled)("uses exactly the functions and events the compiled contracts have", () => {
    for (const [name, abi] of [["LockeVault", vaultAbi], ["LockeVaultFactory", factoryAbi]] as const) {
      const real = JSON.parse(readFileSync(artifact(name), "utf8")).abi as (AbiFunction | AbiEvent)[];
      const sig = (x: AbiFunction | AbiEvent) => (x.type === "function" ? toFunctionSignature(x) : toEventSignature(x));
      const have = new Set(real.filter((x) => x.type === "function" || x.type === "event").map(sig));
      for (const x of abi.filter((x) => x.type === "function" || x.type === "event")) expect(have, `${name}: ${sig(x as AbiFunction)}`).toContain(sig(x as AbiFunction));
    }
  });
});

describe("Stock plans", () => {
  const NVDA_TERMS: MarketTerms = { minPositionUsd: 100, maxLeverage: 25, openFeePct: 0.05, closeFeePct: 0.05, spreadPct: 0.02 };
  it("parses and sizes a stock plan as a short on the stock, sized from the shares held", () => {
    const i = parseBaseInputs({ type: "stocks", pairIndex: 81, valueUsd: 8000, sharePct: 50, leverage: 2, bufferPct: 75 });
    const s = sizeBasePlan(i, NVDA_TERMS);
    expect(s).toMatchObject({ buy: false, notionalUsd: 4000, collateralUsd: 2000, bufferUsd: 1500 });
    expect(s.limits).toEqual({ maxLeverage: 2, maxNotionalUsd: 4400, maxCollateralUsd: 3500 });
    expect(planName(i)).toBe("NVIDIA stock protection");
    expect(planName(parseBaseInputs({ type: "stocks", pairIndex: 78, valueUsd: 8000, sharePct: 50, leverage: 1, bufferPct: 50 }))).toBe("S&P 500 portfolio protection");
  });
  it("refuses a stock market on another plan type, and a crypto market on a stock plan", () => {
    expect(() => parseBaseInputs({ type: "holdings", pairIndex: 81, valueUsd: 1000, sharePct: 50, leverage: 2, bufferPct: 50 })).toThrow("Pick a market");
    expect(() => parseBaseInputs({ type: "stocks", pairIndex: 0, valueUsd: 1000, sharePct: 50, leverage: 2, bufferPct: 50 })).toThrow("Pick a market");
  });
});

describe("Stock catalogue", () => {
  it("lists every tokenized stock Veranta can hedge, plus the two indices, with no duplicates", async () => {
    const { BASE_MARKETS } = await import("@/lib/base/contracts");
    const stocks = BASE_MARKETS.filter((m) => m.type === "stocks");
    expect(stocks.length).toBe(59);
    expect(new Set(BASE_MARKETS.map((m) => m.pairIndex)).size).toBe(BASE_MARKETS.length);
    const tokens = stocks.flatMap((m) => ("token" in m && m.token ? [m.token] : []));
    expect(tokens.length).toBe(57);
    expect(new Set(tokens).size).toBe(57);
    expect(stocks.every((m) => m.buy === false && m.symbol === `${m.asset}/USD`)).toBe(true);
  });
});
