import { NextResponse } from "next/server";
import { requireBaseSession } from "@/lib/server/baseSession";
import { readJson, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { removeEmail, startEmail } from "@/lib/server/userAlerts";

/** Save an address for alerts and send it a confirmation link. */
export const POST = route(async (req: Request) => {
  const s = await requireBaseSession(req);
  rateLimit(`${s.uid}:alerts-email`, 5);
  const body = await readJson(req);
  await startEmail(s.uid, body.email, new URL(req.url).origin);
  return NextResponse.json({ ok: true });
});

export const DELETE = route(async (req: Request) => {
  const s = await requireBaseSession(req);
  await removeEmail(s.uid);
  return NextResponse.json({ ok: true });
});
