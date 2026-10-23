import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { HttpError } from "@/lib/server/errors";
import { readJson, route, str } from "@/lib/server/http";
import { assertSameOrigin, setSessionCookie } from "@/lib/server/session";
import { verifyBuilderSignature } from "@/lib/strike/client";

/**
 * Step 2 of connect. Strike verifies the CIP-30 signature over its challenge; that proves
 * the wallet controls the address, so it doubles as Locke's wallet-signed login.
 */
export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const body = await readJson(req);
  const nonce = str(body, "nonce", 200);
  const signature = str(body, "signature", 8192, /^[0-9a-f]+:[0-9a-f]+$/i);

  const sql = db();
  const [ch] = await sql`
    delete from connect_challenges where nonce = ${nonce} and created_at > now() - interval '5 minutes'
    returning *`;
  if (!ch) throw new HttpError(400, "This sign-in request expired. Try again.");

  const result = await verifyBuilderSignature({ nonce, walletSignature: signature });
  if (result.api_wallet_public_key && result.api_wallet_public_key.toLowerCase() !== ch.api_wallet_public_key) {
    throw new HttpError(502, "Strike registered a different API wallet than expected");
  }
  const expires = result.api_wallet_expired_at ? new Date(Number(result.api_wallet_expired_at) > 1e12 ? Number(result.api_wallet_expired_at) : Number(result.api_wallet_expired_at) * 1000) : null;
  const validExpires = expires && !isNaN(expires.getTime()) ? expires : null;

  const user = await sql.begin(async (tx) => {
    const [u] = await tx`
      insert into users (address, stake_address) values (${ch.address}, ${ch.stake_address})
      on conflict (address) do update set stake_address = coalesce(excluded.stake_address, users.stake_address)
      returning id, address, session_version`;
    await tx`
      insert into strike_links (user_id, account_id, api_wallet_public_key, api_wallet_secret_enc, fee_share_bps, expires_at)
      values (${u.id}, ${result.account_id}, ${ch.api_wallet_public_key}, ${ch.api_wallet_secret_enc}, ${ch.fee_share_bps}, ${validExpires})
      on conflict (user_id) do update set
        account_id = excluded.account_id,
        api_wallet_public_key = excluded.api_wallet_public_key,
        api_wallet_secret_enc = excluded.api_wallet_secret_enc,
        fee_share_bps = excluded.fee_share_bps,
        expires_at = excluded.expires_at,
        updated_at = now()`;
    return u;
  });

  const res = NextResponse.json({ ok: true, accountId: result.account_id });
  setSessionCookie(res, { uid: user.id, addr: user.address, v: Number(user.session_version) });
  return res;
});
