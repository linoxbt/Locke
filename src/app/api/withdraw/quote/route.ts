import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { HttpError } from "@/lib/server/errors";
import { readJson, route } from "@/lib/server/http";
import { strikeKeysFor } from "@/lib/server/keys";
import { reservedUsd } from "@/lib/server/planService";
import { LIMITS, rateLimit } from "@/lib/server/rateLimit";
import { requireSession } from "@/lib/server/session";
import { getAccount, withdrawQuote } from "@/lib/strike/client";

const MAX_USD = 1_000_000;

/** Withdrawals always need the user's own wallet signature and only go to the connected wallet. */
export const POST = route(async (req: Request) => {
  const s = await requireSession(req);
  rateLimit(`${s.uid}:withdraw-quote`, LIMITS.strikeWrite);
  const body = await readJson(req);
  const usd = Number(body.usd);
  if (!Number.isFinite(usd) || usd < 5) throw new HttpError(400, "Minimum withdrawal is $5");
  if (usd > MAX_USD) throw new HttpError(400, "That's more than Locke withdraws in one go");
  const keys = await strikeKeysFor(s.uid);
  // Money credited for a plan that is still opening or waiting to be added as a top-up is spoken for:
  // withdrawing it would leave that plan unfunded with no one told.
  const [acct, reserved] = await Promise.all([getAccount(keys), reservedUsd(s.uid)]);
  const free = Math.max(0, (parseFloat(acct.available_balance) || 0) - reserved);
  if (usd > free + 0.005) {
    throw new HttpError(
      409,
      reserved > 0
        ? `Only $${free.toFixed(2)} is free to withdraw: $${reserved.toFixed(2)} on Strike is set aside for your plans' funding and top-ups.`
        : `Only $${free.toFixed(2)} is free to withdraw.`
    );
  }
  const q = await withdrawQuote(keys, Math.floor(usd * 100) / 100, s.addr);
  if (typeof q.withdraw_id !== "string" || !q.withdraw_id || q.withdraw_id.length > 200) throw new HttpError(502, "Strike returned an unusable withdrawal quote");
  const fee = Number(q.fee);
  await db()`
    insert into withdrawals (id, user_id, usd_value, fee) values (${q.withdraw_id}, ${s.uid}, ${usd}, ${Number.isFinite(fee) ? fee : null})
    on conflict (id) do nothing`;
  return NextResponse.json({
    withdrawId: q.withdraw_id,
    fee: q.fee,
    messageHex: q.message_to_sign,
    txCbor: q.tx_cbor ?? null,
    estimatedReceive: q.estimated_receive ?? null,
  });
});
