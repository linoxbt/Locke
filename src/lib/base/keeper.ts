// What Locke's Base keeper does with one vault, decided from a snapshot of its state. Pure, so
// every rule is tested; worker/base-keeper.ts reads the state and carries the action out.

import { LOCKE_THRESHOLDS, riskLevel } from "../domain/risk";
import type { RiskLevel } from "../domain/types";
import { verantaMarginRatio, verantaTopUpUsd, type VerantaPosition } from "../domain/veranta";
import type { BaseSizing } from "../domain/basePlans";

export type VaultStatus = "funding" | "opening" | "active" | "closed";

export interface VaultState {
  status: VaultStatus;
  sizing: BaseSizing;
  prevLevel: RiskLevel;
  /** USDC idle in the vault. */
  idleUsd: number;
  /** The vault's on-chain cap on notional (also caps the collateral in one position). */
  maxNotionalUsd: number;
  position: VerantaPosition | null;
  mark: number | null;
  marketOpen: boolean;
  paused: boolean;
  /** The vault's keeper is this keeper (the owner can remove it). */
  keeperIsUs: boolean;
  /** Seconds until the vault's one-open-per-hour cooldown ends. */
  cooldownLeftS: number;
  /** An open was sent this long ago and Veranta hasn't filled it yet (null: none in flight). */
  openSentAgoS: number | null;
}

export type KeeperAction =
  | { kind: "wait"; note: string | null }
  | { kind: "open"; collateralUsd: number; leverage: number }
  | { kind: "topUp"; index: number; amountUsd: number }
  | { kind: "needFunds"; amountUsd: number }
  | { kind: "closed"; note: string };

export interface KeeperDecision {
  /** The status the vault should have after this look. */
  status: VaultStatus;
  ratio: number | null;
  level: RiskLevel;
  action: KeeperAction;
}

/** Wait this long for Veranta to fill an open before trying again (fills take seconds). */
export const OPEN_RETRY_S = 120;
/** Top-ups smaller than this aren't worth a transaction. */
export const MIN_TOP_UP_USD = 1;
/** The open fee is taken from the vault next to the collateral; keep this much spare. */
const openFeeReserve = (s: BaseSizing) => s.feesUsd / 2;

export function decide(v: VaultState): KeeperDecision {
  const wait = (status: VaultStatus, note: string | null, ratio: number | null = null, level: RiskLevel = v.prevLevel): KeeperDecision => ({
    status,
    ratio,
    level,
    action: { kind: "wait", note },
  });

  if (v.status === "closed") return wait("closed", null, null, "ok");

  // A live hedge: watch it, and add margin when it gets close.
  if (v.position) {
    const p = v.position;
    if (v.mark == null) return wait("active", "No price from Avantis right now; checking again shortly.");
    const ratio = verantaMarginRatio(p, v.mark);
    const level = riskLevel(ratio, v.prevLevel, LOCKE_THRESHOLDS);
    if (ratio < LOCKE_THRESHOLDS.action) return { status: "active", ratio, level, action: { kind: "wait", note: null } };
    if (!v.keeperIsUs) return wait("active", "Margin is getting thin, and Locke's keeper is removed: add margin or close the hedge.", ratio, level);
    if (!v.marketOpen) return wait("active", "Margin is getting thin and the market is closed; Locke adds margin when it reopens.", ratio, level);

    const wanted = verantaTopUpUsd(p, v.mark, LOCKE_THRESHOLDS.target);
    const room = Math.max(0, v.maxNotionalUsd - p.collateralUsd);
    const amount = Math.floor(Math.min(wanted, room, v.idleUsd) * 100) / 100;
    if (amount >= MIN_TOP_UP_USD) return { status: "active", ratio, level, action: { kind: "topUp", index: p.index, amountUsd: amount } };
    if (wanted > room) return wait("active", "Margin is getting thin and the plan's limit is reached: close part of the hedge or raise the limit.", ratio, level);
    return { status: "active", ratio, level, action: { kind: "needFunds", amountUsd: Math.ceil((wanted - v.idleUsd) * 100) / 100 } };
  }

  // No position on a vault that had one: the owner closed it, or Veranta liquidated it.
  if (v.status === "active") return { status: "closed", ratio: null, level: "ok", action: { kind: "closed", note: "The hedge is closed. The vault's USDC is available to withdraw." } };

  // Funding or opening: open the hedge once everything is in place.
  if (v.openSentAgoS != null && v.openSentAgoS < OPEN_RETRY_S) return wait("opening", "Waiting for Avantis to fill the hedge.");
  if (!v.keeperIsUs) return wait(v.status, "Locke's keeper is removed, so it won't open the hedge.");
  if (v.paused) return wait(v.status, "Locke has paused new hedges for now.");
  if (!v.marketOpen) return wait(v.status, "The market is closed; the hedge opens when it reopens.");
  const need = v.sizing.collateralUsd + openFeeReserve(v.sizing);
  if (v.idleUsd + 1e-9 < need) return wait("funding", `Waiting for the deposit: the vault holds $${v.idleUsd.toFixed(2)} of the $${need.toFixed(2)} the hedge needs.`);
  if (v.cooldownLeftS > 0) return wait(v.status, `Opening again in ${Math.ceil(v.cooldownLeftS / 60)} min (one open per hour).`);
  return { status: "opening", ratio: null, level: "ok", action: { kind: "open", collateralUsd: v.sizing.collateralUsd, leverage: v.sizing.leverage } };
}
