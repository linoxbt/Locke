import { db } from "./db";
import { HttpError } from "./errors";
import { decryptSecret } from "./secrets";
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
  return {
    accountId: row.account_id,
    publicKey: row.api_wallet_public_key,
    privateKey: decryptSecret(row.api_wallet_secret_enc, row.api_wallet_public_key),
    feeShareBps: Number(row.fee_share_bps),
  };
}
