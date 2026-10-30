import { describe, expect, it } from "vitest";
import { USDC } from "@/lib/base/contracts";
import { checkPermission, checkShare, incomeUsd, IncomeError, nextCollectionUsd, WEEK_S } from "@/lib/base/income";

const OWNER = "0x00000000000000000000000000000000000000a1";
const VAULT = "0x00000000000000000000000000000000000000b2";
const NOW = 1_793_300_000;

const signed = (over: Record<string, unknown> = {}) => ({
  account: OWNER,
  spender: VAULT,
  token: USDC,
  allowance: "500000000", // $500
  period: WEEK_S,
  start: NOW - 10,
  end: 281474976710655,
  salt: "1234567890",
  extraData: "0x",
  ...over,
});
const check = (over: Record<string, unknown> = {}) => checkPermission(signed(over), { owner: OWNER, vault: VAULT, now: NOW });

describe("Protect as you get paid: the signed permission", () => {
  it("accepts the owner's weekly USDC permission to this vault", () => {
    const p = check();
    expect(p.allowance).toBe("500000000");
    expect(p.period).toBe(WEEK_S);
    expect(check({ account: OWNER.toUpperCase().replace("0X", "0x") }).account.toLowerCase()).toBe(OWNER);
  });

  it("refuses anything else, with a reason the owner can act on", () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ account: "0x00000000000000000000000000000000000000c3" }, /owner/],
      [{ spender: "0x00000000000000000000000000000000000000c3" }, /spender/],
      [{ token: "0x00000000000000000000000000000000000000c3" }, /USDC/],
      [{ period: 86400 }, /weekly/],
      [{ allowance: "5000000" }, /between/],
      [{ allowance: "100000000001" }, /between/],
      [{ end: NOW - 1 }, /isn't running/],
      [{ start: NOW + 7200 }, /isn't running/],
      [{ allowance: "-1" }, /Invalid allowance/],
      [{ spender: "not an address" }, /Invalid spender/],
    ];
    for (const [over, msg] of cases) expect(() => check(over), JSON.stringify(over)).toThrowError(msg);
    expect(() => checkPermission(null, { owner: OWNER, vault: VAULT, now: NOW })).toThrow(IncomeError);
  });

  it("takes a whole-number share from 5% to 50%", () => {
    expect(checkShare(10)).toBe(10);
    expect(checkShare("25")).toBe(25);
    for (const bad of [4, 51, 12.5, "x", null]) expect(() => checkShare(bad)).toThrow(IncomeError);
  });
});

describe("Protect as you get paid: what moves", () => {
  it("counts USDC from others as income, not money back from the vault or the owner's own", () => {
    const inflows = [
      { from: "0x00000000000000000000000000000000000000c3", valueUsd: 1200 },
      { from: VAULT.toUpperCase().replace("0X", "0x"), valueUsd: 300 },
      { from: OWNER, valueUsd: 50 },
      { from: "0x00000000000000000000000000000000000000d4", valueUsd: 0 },
      { from: "0x00000000000000000000000000000000000000d4", valueUsd: 80 },
    ];
    expect(incomeUsd(inflows, OWNER, VAULT)).toBe(1280);
  });

  it("moves what's owed within the week's allowance, and nothing under $5", () => {
    expect(nextCollectionUsd(128, 500)).toBe(128);
    expect(nextCollectionUsd(800, 500)).toBe(500);
    expect(nextCollectionUsd(800, 3)).toBeNull();
    expect(nextCollectionUsd(4.99, 500)).toBeNull();
    expect(nextCollectionUsd(12.3456789, 500)).toBe(12.345678);
  });
});
