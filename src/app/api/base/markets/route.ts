import { NextResponse } from "next/server";
import { BASE_MARKETS } from "@/lib/base/contracts";
import { marketTerms } from "@/lib/server/baseVaults";
import { HttpError } from "@/lib/server/errors";
import { clientIp, route } from "@/lib/server/http";
import { ipBucket, rateLimit } from "@/lib/server/rateLimit";
import { getMarkets, getSignedPrice } from "@/lib/veranta/client";

/** Every visitor polls this; one answer serves them all for a few seconds. */
const TTL_MS = 5_000;
let cached: { at: number; body: Promise<unknown> } | null = null;

export const GET = route(async (req: Request) => {
  rateLimit(`${ipBucket(clientIp(req)) ?? "anon"}:base-markets`, 60);
  const headers = { "Cache-Control": "public, max-age=5", "Netlify-CDN-Cache-Control": "public, s-maxage=5, stale-while-revalidate=10" };
  // ?pair=81: one market with its live price (stock prices are fetched only for the stock in view).
  const pair = new URL(req.url).searchParams.get("pair");
  if (pair != null) {
    const b = BASE_MARKETS.find((m) => String(m.pairIndex) === pair);
    if (!b) throw new HttpError(404, "Unknown market");
    const hit = one.get(b.pairIndex);
    if (hit && Date.now() - hit.at <= TTL_MS) return NextResponse.json(await hit.body, { headers });
    const body = describe(b, await getMarkets(), true).then((market) => ({ market }));
    one.set(b.pairIndex, { at: Date.now(), body });
    body.catch(() => one.delete(b.pairIndex));
    return NextResponse.json(await body, { headers });
  }
  if (!cached || Date.now() - cached.at > TTL_MS) {
    const body = load();
    cached = { at: Date.now(), body };
    body.catch(() => (cached = null));
  }
  return NextResponse.json(await cached.body, { headers });
});

const one = new Map<number, { at: number; body: Promise<unknown> }>();

async function describe(b: (typeof BASE_MARKETS)[number], all: Awaited<ReturnType<typeof getMarkets>>, withPrice: boolean) {
  const m = all.find((x) => x.index === b.pairIndex);
  const price = withPrice ? await getSignedPrice(b.pairIndex, { forDisplay: true }).catch(() => null) : null;
  return {
    ...b,
    available: !!m && m.listed && !m.closeOnly,
    marketOpen: m?.marketOpen ?? false,
    price: price?.price ?? null,
    priceAt: price?.publishedAt ? new Date(price.publishedAt).toISOString() : null,
    terms: m ? marketTerms(m) : null,
    carryPctPerHour: m ? (b.buy ? m.carryPctPerHour.long : m.carryPctPerHour.short) : null,
  };
}

/** Every market with its terms; live prices for crypto and oil only (the landing page shows them). */
async function load() {
  const all = await getMarkets();
  return { markets: await Promise.all(BASE_MARKETS.map((b) => describe(b, all, b.type !== "stocks"))) };
}
