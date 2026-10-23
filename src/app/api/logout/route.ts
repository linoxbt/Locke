import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { assertSameOrigin, clearSessionCookie, currentSession, revokeSessions } from "@/lib/server/session";

/** Signing out ends the session everywhere: a copied cookie stops working too. */
export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const s = await currentSession();
  if (s) await revokeSessions(s.uid);
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
});
