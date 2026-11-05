import { NextResponse } from "next/server";
import { requireBaseSession } from "@/lib/server/baseSession";
import { HttpError } from "@/lib/server/errors";
import { route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { siteUrl } from "@/lib/server/emailTemplate";
import { notifyUser } from "@/lib/server/userAlerts";

/** Send a test alert to every channel this account has linked. */
export const POST = route(async (req: Request) => {
  const s = await requireBaseSession(req);
  rateLimit(`${s.uid}:alerts-test`, 3);
  const sent = await notifyUser(s.uid, "Locke: test alert", "This is a test. Alerts about your plans will arrive here.", {
    preheader: "Alerts about your plans will arrive here.",
    eyebrow: "Test alert",
    title: "Your alerts are working",
    paragraphs: ["This is a test. From now on, Locke tells you here when a hedge opens or closes, when margin runs thin, and when a plan needs money."],
    cta: { label: "Open your plans", url: `${siteUrl()}/portfolio` },
    tone: "ok",
    footnote: "You get this because you asked for a test alert in your Locke account."
  });
  if (sent.length === 0) throw new HttpError(400, "Nothing was sent. Link Telegram or confirm your email first.");
  return NextResponse.json({ sent });
});
