import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { assertSameOrigin, clearSessionCookie } from "@/lib/server/session";

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
});
