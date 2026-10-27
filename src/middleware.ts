import { NextResponse, type NextRequest } from "next/server";

/** A plan's read-only pages, which a shared link opens without signing in (the page decides what it shows). */
const SHARED_PLAN = /^\/plans\/[0-9a-f-]{36}(?:\/(?:preview|replay|activity|strike))?\/?$/i;

/**
 * Edge gate for signed-in areas: no session cookie → /connect with the exact page to return
 * to, except a plan's read-only pages, which a shared link can open. Only checks presence;
 * every page and API route still verifies the signed cookie on the server (an expired or
 * forged cookie is caught there). The cookie is __Host-locke_session over https and
 * locke_session under `next dev`.
 */
export function middleware(req: NextRequest) {
  if (req.cookies.get("__Host-locke_session")?.value || req.cookies.get("locke_session")?.value) return NextResponse.next();
  if (SHARED_PLAN.test(req.nextUrl.pathname)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/connect";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/portfolio/:path*", "/protect/:path*", "/plans/:path*", "/withdraw/:path*", "/account/:path*"],
};
