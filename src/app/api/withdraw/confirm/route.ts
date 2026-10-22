import { NextResponse } from "next/server";
import { HttpError } from "@/lib/server/errors";
import { readJson, route } from "@/lib/server/http";
import { strikeKeysFor } from "@/lib/server/keys";
import { requireSession } from "@/lib/server/session";
import { withdrawConfirm } from "@/lib/strike/client";

export const POST = route(async (req: Request) => {
  const s = await requireSession(req);
  const body = await readJson(req);
  const withdrawId = String(body.withdrawId ?? "");
  const signature = String(body.signature ?? "");
  if (!withdrawId || !/^[0-9a-f]+:[0-9a-f]+$/i.test(signature)) throw new HttpError(400, "Missing wallet signature");
  const signedTx = body.signedTxCbor ? String(body.signedTxCbor) : undefined;
  await withdrawConfirm(await strikeKeysFor(s.uid), withdrawId, signature, signedTx);
  return NextResponse.json({ ok: true });
});
