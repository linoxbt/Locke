import { NextResponse } from "next/server";
import { parseStrikeExpiry, strikeConnect, walletSignatureProblem } from "@/lib/server/connect";
import { db } from "@/lib/server/db";
import { HttpError } from "@/lib/server/errors";
import { readJson, route, str } from "@/lib/server/http";
import { assertSameOrigin, setSessionCookie } from "@/lib/server/session";
import { verifyBuilderSignature } from "@/lib/strike/client";

/**
 * Step 2 of connect. Locke checks the CIP-30 signature itself (key ↔ address, exact challenge,
 * Ed25519), then Strike verifies it and registers the API wallet. Together that proves the
 * wallet controls the address, so it doubles as Locke's wallet-signed login.
 */
export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const body = await readJson(req);
  const nonce = str(body, "nonce", 200);
  const signature = str(body, "signature", 8192, /^[0-9a-f]+:[0-9a-f]+$/i);

  const sql = db();
  // Single use: the challenge is gone whatever happens next. Rows without a message are
  // reservations whose Strike call never finished (or predate the check).
  const [ch] = await sql`
    delete from connect_challenges
    where nonce = ${nonce} and message is not null and created_at > now() - interval '5 minutes'
    returning *`;
  if (!ch) throw new HttpError(400, "This sign-in request expired. Try again.");

  const problem = walletSignatureProblem({ signature, address: ch.address, message: ch.message });
  if (problem) {
    console.warn("[connect] signature refused:", problem, ch.address);
    throw new HttpError(400, "That signature isn't from this wallet address. Pick the account you're signing in with in your wallet and try again.");
  }

  const result = await strikeConnect(verifyBuilderSignature({ nonce, walletSignature: signature }));
  if (typeof result.account_id !== "string" || !result.account_id) throw new HttpError(502, "Strike didn't return an account for this wallet");
  if (result.api_wallet_public_key && result.api_wallet_public_key.toLowerCase() !== ch.api_wallet_public_key) {
    throw new HttpError(502, "Strike registered a different API wallet than expected");
  }
  const expires = parseStrikeExpiry(result.api_wallet_expired_at);

  const user = await sql.begin(async (tx) => {
    const [u] = await tx`
      insert into users (address, stake_address) values (${ch.address}, ${ch.stake_address})
      on conflict (address) do update set stake_address = coalesce(excluded.stake_address, users.stake_address)
      returning id, address, session_version`;
    // One address, one Strike account. A different account for a known user is never silently swapped in.
    const [link] = await tx`select account_id from strike_links where user_id = ${u.id} for update`;
    if (link && link.account_id !== result.account_id) {
      console.error("[connect] Strike account changed for user", u.id, "from", link.account_id, "to", result.account_id);
      throw new HttpError(409, "Strike linked this wallet to a different account than before, so Locke didn't sign you in. Contact support before trying again.");
    }
    await tx`
      insert into strike_links (user_id, account_id, api_wallet_public_key, api_wallet_secret_enc, fee_share_bps, expires_at)
      values (${u.id}, ${result.account_id}, ${ch.api_wallet_public_key}, ${ch.api_wallet_secret_enc}, ${ch.fee_share_bps}, ${expires})
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
