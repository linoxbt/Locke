import { NextResponse } from "next/server";
import { HttpError } from "@/lib/server/errors";
import { readJson, route } from "@/lib/server/http";
import { strikeKeysFor } from "@/lib/server/keys";
import { requireSession } from "@/lib/server/session";
import { withdrawQuote } from "@/lib/strike/client";

/** Withdrawals always need the user's own wallet signature and only go to the connected wallet. */
export const POST = route(async (req: Request) => {
  const s = await requireSession(req);
  const body = await readJson(req);
  const usd = Number(body.usd);
  if (!isFinite(usd) || usd < 5) throw new HttpError(400, "Minimum withdrawal is $5");
  const q = await withdrawQuote(await strikeKeysFor(s.uid), usd, s.addr);
  return NextResponse.json({
    withdrawId: q.withdraw_id,
    fee: q.fee,
    messageHex: q.message_to_sign,
    txCbor: q.tx_cbor ?? null,
    estimatedReceive: q.estimated_receive ?? null,
  });
});
