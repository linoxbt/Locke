import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { HttpError } from "@/lib/server/errors";
import { readJson, route, str } from "@/lib/server/http";
import { strikeKeysFor } from "@/lib/server/keys";
import { requireSession } from "@/lib/server/session";
import { withdrawConfirm } from "@/lib/strike/client";

/** Confirms a quote this user asked for, with their wallet's signature and (when Strike built one) the fully signed transaction. */
export const POST = route(async (req: Request) => {
  const s = await requireSession(req);
  const body = await readJson(req);
  const withdrawId = str(body, "withdrawId", 200);
  const signature = str(body, "signature", 8192, /^[0-9a-f]+:[0-9a-f]+$/i);
  const signedTx = body.signedTxCbor == null ? undefined : str(body, "signedTxCbor", 64_000, /^[0-9a-f]+$/i);

  const sql = db();
  const [w] = await sql`select status from withdrawals where id = ${withdrawId} and user_id = ${s.uid}`;
  if (!w) throw new HttpError(404, "Withdrawal quote not found. Start again.");
  if (w.status === "confirmed") return NextResponse.json({ ok: true });

  try {
    await withdrawConfirm(await strikeKeysFor(s.uid), withdrawId, signature, signedTx);
  } catch (e) {
    await sql`update withdrawals set status = 'failed', error = ${String((e as Error).message).slice(0, 500)}, updated_at = now()
              where id = ${withdrawId} and status = 'quoted'`;
    throw e;
  }
  await sql`update withdrawals set status = 'confirmed', error = null, updated_at = now() where id = ${withdrawId}`;
  return NextResponse.json({ ok: true });
});
