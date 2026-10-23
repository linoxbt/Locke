import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge gate for signed-in areas: no session cookie → /connect with the exact page to return
 * to. Only checks presence; every page and API route still verifies the signed cookie on the
 * server (an expired or forged cookie is caught there). The cookie is __Host-locke_session over
 * https and locke_session under `next dev`.
 */
export function middleware(req: NextRequest) {
  if (req.cookies.get("__Host-locke_session")?.value || req.cookies.get("locke_session")?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/connect";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/portfolio/:path*", "/protect/:path*", "/plans/:path*", "/withdraw/:path*", "/account/:path*"],
};
