import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/session";
import { route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { telegramLink, unlinkTelegram } from "@/lib/server/userAlerts";

/** A one-time link to Locke's bot that links the chat it is opened in. */
export const POST = route(async (req: Request) => {
  const s = await requireSession(req);
  rateLimit(`${s.uid}:alerts-telegram`, 10);
  return NextResponse.json({ url: await telegramLink(s.uid) });
});

export const DELETE = route(async (req: Request) => {
  const s = await requireSession(req);
  await unlinkTelegram(s.uid);
  return NextResponse.json({ ok: true });
});
