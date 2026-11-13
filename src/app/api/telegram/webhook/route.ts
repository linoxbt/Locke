import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { telegramUpdate } from "@/lib/server/userAlerts";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Telegram posts the bot's updates here, with the secret Locke set on the webhook. */
export const POST = route(async (req: Request) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!secret || !same(req.headers.get("x-telegram-bot-api-secret-token") ?? "", secret)) return new NextResponse(null, { status: 401 });
  const update = await req.json().catch(() => null);
  // Telegram retries anything but a 200, so a bad update is answered 200 and dropped.
  if (update) await telegramUpdate(update).catch((e) => console.warn(`[telegram] ${(e as Error).message}`));
  return NextResponse.json({ ok: true });
});
