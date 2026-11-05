import { NextResponse } from "next/server";
import { requireBaseSession } from "@/lib/server/baseSession";
import { saveDraft } from "@/lib/server/baseVaults";
import { readJson, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";

/** The plan a signed-in business is about to create on Base, kept in case saving it never happens. */
export const POST = route(async (req: Request) => {
  const s = await requireBaseSession(req);
  rateLimit(`${s.uid}:base-draft`, 20);
  const body = await readJson(req);
  await saveDraft(s.uid, body.inputs, body.eligibility);
  return NextResponse.json({ ok: true });
});
