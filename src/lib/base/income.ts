// "Protect as you get paid": the owner's Base Account signs a spend permission naming its vault as
// spender (up to a weekly cap, in USDC). Locke's keeper watches USDC arriving in the owner's
// account and moves the owner's chosen share of it into the vault, never more per week than the
// cap. The vault contract checks the permission is the owner's, to itself, in USDC
// (LockeVault.collectIncome); Base Account's SpendPermissionManager enforces the cap.

import { getAddress, parseAbi, type Address, type Hex } from "viem";
import { USDC } from "./contracts";

export const SPEND_PERMISSION_MANAGER: Address = "0xf85210B21cC50302F477BA56686d2019dC9b67Ad";

/** Smallest sweep worth a transaction. */
export const MIN_COLLECT_USD = 5;
export const SHARE_RANGE = { min: 5, max: 50 } as const;
export const WEEKLY_CAP_RANGE = { min: 10, max: 100_000 } as const;
export const WEEK_S = 7 * 86400;

/** A spend permission as Base Account signs it (the manager's struct; big numbers as strings in JSON). */
export interface SpendPermission {
  account: Address;
  spender: Address;
  token: Address;
  allowance: string;
  period: number;
  start: number;
  end: number;
  salt: string;
  extraData: Hex;
}

export const spendPermissionManagerAbi = parseAbi([
  "struct SpendPermission { address account; address spender; address token; uint160 allowance; uint48 period; uint48 start; uint48 end; uint256 salt; bytes extraData; }",
  "function approveWithSignature(SpendPermission spendPermission, bytes signature) returns (bool)",
  "function isApproved(SpendPermission spendPermission) view returns (bool)",
  "function isRevoked(SpendPermission spendPermission) view returns (bool)",
  "function getCurrentPeriod(SpendPermission spendPermission) view returns ((uint48 start, uint48 end, uint160 spend))",
  "function revoke(SpendPermission spendPermission)",
]);

export const collectIncomeAbi = parseAbi([
  "struct SpendPermission { address account; address spender; address token; uint160 allowance; uint48 period; uint48 start; uint48 end; uint256 salt; bytes extraData; }",
  "function collectIncome(SpendPermission permission, bytes signature, uint160 amount)",
  "event IncomeCollected(address indexed from, uint256 amount)",
]);

/** The struct as contracts take it. */
export function onChain(p: SpendPermission) {
  return {
    account: p.account,
    spender: p.spender,
    token: p.token,
    allowance: BigInt(p.allowance),
    period: p.period,
    start: p.start,
    end: p.end,
    salt: BigInt(p.salt),
    extraData: p.extraData,
  };
}

export class IncomeError extends Error {}

/**
 * Parse and check a signed permission for a vault: from its owner, to the vault, in USDC, weekly,
 * with a cap in range and still running. Throws IncomeError with a reason the owner can act on.
 */
export function checkPermission(raw: unknown, expected: { owner: string; vault: string; now: number }): SpendPermission {
  const r = (raw ?? {}) as Record<string, unknown>;
  const addr = (v: unknown, what: string): Address => {
    if (typeof v !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(v)) throw new IncomeError(`Invalid ${what}`);
    return getAddress(v);
  };
  // A uint as a decimal string. Wallets send some fields as numbers and some (the salt) as 0x hex;
  // both name the same value, which is what was signed. Out-of-range values would fail on chain.
  const int = (v: unknown, what: string, bits: number) => {
    const s = typeof v === "number" && Number.isSafeInteger(v) ? String(v) : v;
    if (typeof s !== "string" || !/^(\d{1,78}|0x[0-9a-fA-F]{1,64})$/.test(s)) throw new IncomeError(`Invalid ${what}`);
    const n = BigInt(s);
    if (n >= 1n << BigInt(bits)) throw new IncomeError(`Invalid ${what}`);
    return n.toString();
  };
  const p: SpendPermission = {
    account: addr(r.account, "account"),
    spender: addr(r.spender, "spender"),
    token: addr(r.token, "token"),
    allowance: int(r.allowance, "allowance", 160),
    period: Number(int(r.period, "period", 48)),
    start: Number(int(r.start, "start", 48)),
    end: Number(int(r.end, "end", 48)),
    salt: int(r.salt, "salt", 256),
    extraData: r.extraData == null ? "0x" : (r.extraData as Hex),
  };
  // Signed as given: replacing a malformed value would only make the signature fail later.
  if (typeof p.extraData !== "string" || !/^0x([0-9a-fA-F]{2}){0,1024}$/.test(p.extraData)) throw new IncomeError("Invalid extraData");
  if (p.account.toLowerCase() !== expected.owner.toLowerCase()) throw new IncomeError("The permission must come from the vault's owner");
  if (p.spender.toLowerCase() !== expected.vault.toLowerCase()) throw new IncomeError("The permission must name this vault as spender");
  if (p.token.toLowerCase() !== USDC.toLowerCase()) throw new IncomeError("The permission must be for USDC on Base");
  if (p.period !== WEEK_S) throw new IncomeError("The permission must reset weekly");
  const capUsd = Number(BigInt(p.allowance)) / 1e6;
  if (capUsd < WEEKLY_CAP_RANGE.min || capUsd > WEEKLY_CAP_RANGE.max) throw new IncomeError(`The weekly cap must be between $${WEEKLY_CAP_RANGE.min} and $${WEEKLY_CAP_RANGE.max.toLocaleString("en-US")}`);
  if (p.end <= expected.now || p.start > expected.now + 3600) throw new IncomeError("The permission isn't running");
  return p;
}

export function checkShare(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < SHARE_RANGE.min || n > SHARE_RANGE.max) throw new IncomeError(`The share must be a whole number from ${SHARE_RANGE.min}% to ${SHARE_RANGE.max}%`);
  return n;
}

/** A USDC transfer into the owner's account. */
export interface Inflow {
  from: string;
  valueUsd: number;
}

/**
 * What counts as income: USDC arriving in the owner's account from someone else. Money coming back
 * from the owner's own Locke vaults (withdrawals, from this vault or any other) or from the owner's
 * own address isn't income.
 */
export function incomeUsd(inflows: Inflow[], owner: string, ownVaults: string | string[]): number {
  const skip = new Set([owner, ...(Array.isArray(ownVaults) ? ownVaults : [ownVaults])].map((a) => a.toLowerCase()));
  return inflows.filter((i) => i.valueUsd > 0 && !skip.has(i.from.toLowerCase())).reduce((s, i) => s + i.valueUsd, 0);
}

/** How much to move now: what's owed, capped by what's left of this week's allowance; nothing below the minimum. */
export function nextCollectionUsd(pendingUsd: number, allowanceLeftUsd: number): number | null {
  const amount = Math.floor(Math.min(pendingUsd, allowanceLeftUsd) * 1e6) / 1e6;
  return amount >= MIN_COLLECT_USD ? amount : null;
}
