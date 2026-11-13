import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { telegramUpdate } from "@/lib/server/userAlerts";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * The bot's updates, with the shared secret: from Telegram itself, or passed on by Locke's other
 * site, which receives the bot's webhook (`x-locke-forwarded: 1`; then /stop is answered with a
 * count, not a message).
 */
export const POST = route(async (req: Request) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!secret || !same(req.headers.get("x-telegram-bot-api-secret-token") ?? "", secret)) return new NextResponse(null, { status: 401 });
  const update = await req.json().catch(() => null);
  const forwarded = req.headers.get("x-locke-forwarded") === "1";
  // Telegram retries anything but a 200, so a bad update is answered 200 and dropped.
  const result = update ? await telegramUpdate(update, { forwarded }).catch((e) => console.warn(`[telegram] ${(e as Error).message}`)) : undefined;
  return NextResponse.json({ ok: true, ...(result ?? {}) });
});
