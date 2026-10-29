import { NextResponse } from "next/server";
import { clearBaseSessionCookie, currentBaseSession, revokeBaseSessions } from "@/lib/server/baseSession";
import { route } from "@/lib/server/http";
import { assertSameOrigin } from "@/lib/server/session";

/** Signing out of Locke on Base ends that session everywhere. */
export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const s = await currentBaseSession();
  if (s) await revokeBaseSessions(s.uid);
  const res = NextResponse.json({ ok: true });
  clearBaseSessionCookie(res);
  return res;
});
