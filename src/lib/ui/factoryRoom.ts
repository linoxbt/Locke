// What Locke's factory on Base takes right now: whether it's paused, and the launch caps on deposits
// (per vault and across all vaults). Read on the server for the page and again from the wallet just
// before sending, so a plan or deposit the factory would refuse is never sent.

import type { Address } from "viem";
import { factoryAbi, fromUsdcUnits, usdcUnits } from "../base/contracts";
import { usd } from "./format";

export interface FactoryRoom {
  /** New plans are stopped (createVault reverts). An owner's own deposits still work. */
  paused: boolean;
  /** Most a vault may hold in deposits less withdrawals, USD. */
  maxVaultUsd: number;
  /** What all vaults together may still take, USD. */
  totalRoomUsd: number;
}

type Read = "paused" | "maxVaultDeposits" | "maxTotalDeposits" | "totalDeposits";
type Reader = { readContract(args: { address: Address; abi: typeof factoryAbi; functionName: Read }): Promise<unknown> };

/** Reads through any client: the server's, or the wallet's just before a send. */
export async function readFactoryRoom(reader: Reader, factory: Address): Promise<FactoryRoom> {
  const read = (functionName: Read) => reader.readContract({ address: factory, abi: factoryAbi, functionName });
  const [paused, maxVault, maxTotal, total] = await Promise.all([read("paused"), read("maxVaultDeposits"), read("maxTotalDeposits"), read("totalDeposits")]);
  const room = (maxTotal as bigint) - (total as bigint);
  return { paused: !!paused, maxVaultUsd: fromUsdcUnits(maxVault as bigint), totalRoomUsd: fromUsdcUnits(room > 0n ? room : 0n) };
}

/**
 * Why the factory would refuse this deposit, in words, or null when it's fine. `vaultUsd` is what
 * the vault already holds in deposits less withdrawals (0 for a new plan). A paused factory blocks
 * only new plans: an owner may still add to a vault.
 */
export function roomProblem(room: FactoryRoom, amountUsd: number, { newPlan, vaultUsd = 0 }: { newPlan: boolean; vaultUsd?: number }): string | null {
  if (newPlan && room.paused) return "Locke has paused new plans for now. Plans already open aren't affected, and you can still withdraw or close them.";
  const amount = usdcUnits(amountUsd);
  if (usdcUnits(vaultUsd) + amount > usdcUnits(room.maxVaultUsd)) {
    return newPlan
      ? `During launch a plan can hold at most ${usd(room.maxVaultUsd)}, and this one needs ${usd(amountUsd)}. Lower the amount or the share to protect.`
      : `During launch a plan can hold at most ${usd(room.maxVaultUsd)}, so this vault can take ${usd(Math.max(0, room.maxVaultUsd - vaultUsd))} more.`;
  }
  if (amount > usdcUnits(room.totalRoomUsd)) {
    return room.totalRoomUsd < 1
      ? "Locke has reached its launch limit across all plans, so it can't take new deposits until the limit is raised."
      : `Locke is close to its launch limit across all plans: it can take ${usd(room.totalRoomUsd)} more right now.`;
  }
  return null;
}
