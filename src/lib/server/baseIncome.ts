// "Protect as you get paid" on the server: turning it on (checking the owner's signed spend
// permission against Base) and off, and reading its state for the vault page.

import { getAddress, type Address, type Hex } from "viem";
import { vaultAbi } from "../base/contracts";
import { checkPermission, checkShare, IncomeError, onChain, SPEND_PERMISSION_MANAGER, spendPermissionManagerAbi, type SpendPermission } from "../base/income";
import { basePublicClient } from "./baseChain";
import { addVaultEvent } from "./baseVaults";
import { db } from "./db";
import { HttpError } from "./errors";

export interface IncomeView {
  status: "on" | "off";
  sharePct: number;
  weeklyCapUsd: number;
  pendingUsd: number;
  collectedUsd: number;
  lastCollectedAt: string | null;
  permission: SpendPermission;
}

/** The vault's income setting, or null when never turned on (or the table isn't there yet). */
export async function incomeFor(vault: string): Promise<IncomeView | null> {
  try {
    const [r] = await db()`select * from base_income where vault = ${vault.toLowerCase()}`;
    if (!r) return null;
    const permission = r.permission as SpendPermission;
    return {
      status: r.status,
      sharePct: Number(r.share_pct),
      weeklyCapUsd: Number(BigInt(permission.allowance)) / 1e6,
      pendingUsd: Number(r.pending_usd),
      collectedUsd: Number(r.collected_usd),
      lastCollectedAt: r.last_collected_at ? new Date(r.last_collected_at).toISOString() : null,
      permission,
    };
  } catch (e) {
    if ((e as { code?: string }).code === "42P01") return null; // base_income not migrated yet
    throw e;
  }
}

async function ownedVault(uid: string, address: string): Promise<string> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new HttpError(404, "Vault not found");
  const vault = address.toLowerCase();
  const [row] = await db()`select status from base_vaults where address = ${vault} and user_id = ${uid}`;
  if (!row) throw new HttpError(404, "Vault not found");
  if (row.status === "closed") throw new HttpError(409, "This vault is closed.");
  return vault;
}

/**
 * Turn it on: the permission must be the vault owner's (as on Base now), to this vault, in USDC,
 * weekly, and its signature must be one the SpendPermissionManager accepts (checked by simulating
 * the approval on Base). Income counts from the current block.
 */
export async function enableIncome(uid: string, address: string, body: Record<string, unknown>): Promise<IncomeView> {
  const vault = await ownedVault(uid, address);
  const client = basePublicClient();
  const owner = (await client.readContract({ address: getAddress(vault), abi: vaultAbi, functionName: "owner" })) as Address;
  let permission: SpendPermission;
  let sharePct: number;
  try {
    permission = checkPermission(body.permission, { owner, vault, now: Math.floor(Date.now() / 1000) });
    sharePct = checkShare(body.sharePct);
  } catch (e) {
    if (e instanceof IncomeError) throw new HttpError(400, e.message);
    throw e;
  }
  const signature = body.signature;
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature) || signature.length > 20_000) throw new HttpError(400, "Invalid signature");

  const p = onChain(permission);
  const read = <T>(functionName: "isRevoked" | "isApproved") =>
    client.readContract({ address: SPEND_PERMISSION_MANAGER, abi: spendPermissionManagerAbi, functionName, args: [p] }) as Promise<T>;
  if (await read<boolean>("isRevoked")) throw new HttpError(400, "This permission was revoked. Sign a new one.");
  if (!(await read<boolean>("isApproved"))) {
    try {
      await client.simulateContract({ address: SPEND_PERMISSION_MANAGER, abi: spendPermissionManagerAbi, functionName: "approveWithSignature", args: [p, signature as Hex], account: getAddress(vault) });
    } catch {
      throw new HttpError(400, "Base Account didn't accept this signature for the permission.");
    }
  }
  const block = await client.getBlockNumber();
  await db()`
    insert into base_income (vault, permission, signature, share_pct, status, last_block)
    values (${vault}, ${db().json(permission as never)}, ${signature}, ${sharePct}, 'on', ${block.toString()})
    on conflict (vault) do update set permission = excluded.permission, signature = excluded.signature, share_pct = excluded.share_pct,
      status = 'on', last_block = excluded.last_block, pending_usd = 0, updated_at = now()`;
  const capUsd = Number(BigInt(permission.allowance)) / 1e6;
  await addVaultEvent(vault, "info", `Protect as you get paid is on: ${sharePct}% of incoming USDC, up to $${capUsd.toLocaleString("en-US")} a week`);
  return (await incomeFor(vault))!;
}

/** Turn it off. The owner revokes the permission from their wallet too; the keeper stops either way. */
export async function disableIncome(uid: string, address: string): Promise<void> {
  const vault = await ownedVault(uid, address).catch(async (e) => {
    // A closed vault can still turn it off.
    if (e instanceof HttpError && e.status === 409) return address.toLowerCase();
    throw e;
  });
  const [row] = await db()`update base_income set status = 'off', updated_at = now() where vault = ${vault} and status = 'on' returning vault`;
  if (row) await addVaultEvent(vault, "info", "Protect as you get paid is off");
}
