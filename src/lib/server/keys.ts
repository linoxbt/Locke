import { db } from "./db";
import { HttpError } from "./errors";
import { decryptSecret, encryptSecret } from "./secrets";
import type { ApiKeys } from "../strike/client";

/** The user's decrypted Strike API wallet. Server and worker only. */
export async function strikeKeysFor(userId: string): Promise<ApiKeys & { accountId: string }> {
  const [row] = await db()`
    select account_id, api_wallet_public_key, api_wallet_secret_enc, fee_share_bps, expires_at
    from strike_links where user_id = ${userId}`;
  if (!row) throw new HttpError(401, "Connect your wallet to Strike first");
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    throw new HttpError(401, "Your Strike connection expired. Reconnect your wallet.");
  }
  const privateKey = decryptSecret(row.api_wallet_secret_enc, row.api_wallet_public_key);
  if (String(row.api_wallet_secret_enc).startsWith("v1.")) await upgradeSecret(userId, row.api_wallet_public_key, row.api_wallet_secret_enc, privateKey);
  return {
    accountId: row.account_id,
    publicKey: row.api_wallet_public_key,
    privateKey,
    feeShareBps: Number(row.fee_share_bps),
  };
}

/**
 * Lazy migration: a v1 ciphertext (no AAD) is rewritten as v2, bound to its public key. Only if
 * the row still holds the exact ciphertext read, so a reconnect in between is never overwritten.
 * A failure is logged and retried next time; the caller already has the key.
 */
async function upgradeSecret(userId: string, publicKey: string, oldEnc: string, privateKey: string) {
  try {
    await db()`
      update strike_links set api_wallet_secret_enc = ${encryptSecret(privateKey, publicKey)}, updated_at = now()
      where user_id = ${userId} and api_wallet_secret_enc = ${oldEnc}`;
  } catch (e) {
    console.error("[keys] v1 → v2 re-encryption failed:", (e as Error).message);
  }
}
