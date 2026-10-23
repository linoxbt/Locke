import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { HttpError } from "@/lib/server/errors";
import { readJson, route, str } from "@/lib/server/http";
import { strikeKeysFor } from "@/lib/server/keys";
import { LIMITS, rateLimit } from "@/lib/server/rateLimit";
import { requireSession } from "@/lib/server/session";
import { StrikeError, withdrawConfirm } from "@/lib/strike/client";

/** Confirms a quote this user asked for, with their wallet's signature and (when Strike built one) the fully signed transaction. */
export const POST = route(async (req: Request) => {
  const s = await requireSession(req);
  rateLimit(`${s.uid}:withdraw-confirm`, LIMITS.strikeWrite);
  const body = await readJson(req);
  const withdrawId = str(body, "withdrawId", 200);
  const signature = str(body, "signature", 8192, /^[0-9a-f]+:[0-9a-f]+$/i);
  const signedTx = body.signedTxCbor == null ? undefined : str(body, "signedTxCbor", 64_000, /^[0-9a-f]+$/i);

  const sql = db();
  const [w] = await sql`select status from withdrawals where id = ${withdrawId} and user_id = ${s.uid}`;
  if (!w) throw new HttpError(404, "Withdrawal quote not found. Start again.");
  if (w.status === "confirmed") return NextResponse.json({ ok: true });

  const keys = await strikeKeysFor(s.uid);
  try {
    await withdrawConfirm(keys, withdrawId, signature, signedTx);
  } catch (e) {
    // Only a 4xx is a definite no. A timeout or 5xx may have gone through on Strike's side,
    // so the quote stays open and the user checks before sending another.
    if (e instanceof StrikeError && e.status >= 400 && e.status < 500) {
      await sql`update withdrawals set status = 'failed', error = ${e.message.slice(0, 500)}, updated_at = now()
                where id = ${withdrawId} and status = 'quoted'`;
      throw e;
    }
    console.error("[withdraw] confirm outcome unknown:", withdrawId, (e as Error).message);
    throw new HttpError(502, "Strike didn't confirm the withdrawal, but it may still go through. Check your Strike balance before trying again.");
  }
  await sql`update withdrawals set status = 'confirmed', error = null, updated_at = now() where id = ${withdrawId}`;
  return NextResponse.json({ ok: true });
});
