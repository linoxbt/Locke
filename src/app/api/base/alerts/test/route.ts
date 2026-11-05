import { NextResponse } from "next/server";
import { requireBaseSession } from "@/lib/server/baseSession";
import { HttpError } from "@/lib/server/errors";
import { route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { notifyUser } from "@/lib/server/userAlerts";

/** Send a test alert to every channel this account has linked. */
export const POST = route(async (req: Request) => {
  const s = await requireBaseSession(req);
  rateLimit(`${s.uid}:alerts-test`, 3);
  const sent = await notifyUser(s.uid, "Locke: test alert", "This is a test. Alerts about your plans will arrive here.");
  if (sent.length === 0) throw new HttpError(400, "Nothing was sent. Link Telegram or confirm your email first.");
  return NextResponse.json({ sent });
});
