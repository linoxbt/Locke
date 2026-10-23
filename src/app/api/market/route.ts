import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { getMarkPrice } from "@/lib/strike/client";

/**
 * Public ADA and WTI marks for the landing page. Cached at the edge for a few seconds so visitors
 * share one Strike call, and one market failing doesn't blank the other (it comes back null).
 */
export const GET = route(async () => {
  const [ada, wti] = await Promise.allSettled([getMarkPrice("ADA-USD"), getMarkPrice("WTI-USD")]);
  const value = <T,>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : null);
  const body = { ada: value(ada), wti: value(wti) };
  const ok = body.ada != null || body.wti != null;
  return NextResponse.json(body, {
    status: ok ? 200 : 502,
    headers: ok
      ? { "Cache-Control": "public, max-age=0, must-revalidate", "Netlify-CDN-Cache-Control": "public, s-maxage=3, stale-while-revalidate=10" }
      : { "Cache-Control": "no-store" },
  });
});
