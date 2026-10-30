import { NextResponse } from "next/server";
import { BASE_MARKETS } from "@/lib/base/contracts";
import { marketTerms } from "@/lib/server/baseVaults";
import { clientIp, route } from "@/lib/server/http";
import { ipBucket, rateLimit } from "@/lib/server/rateLimit";
import { getMarkets, getSignedPrice } from "@/lib/veranta/client";

/** The markets Locke offers on Base, with Veranta's live terms and price, for the plan form. */
/** Every visitor polls this; one answer serves them all for a few seconds. */
const TTL_MS = 5_000;
let cached: { at: number; body: Promise<unknown> } | null = null;

export const GET = route(async (req: Request) => {
  rateLimit(`${ipBucket(clientIp(req)) ?? "anon"}:base-markets`, 60);
  if (!cached || Date.now() - cached.at > TTL_MS) {
    const body = load();
    cached = { at: Date.now(), body };
    body.catch(() => (cached = null));
  }
  return NextResponse.json(await cached.body, {
    headers: { "Cache-Control": "public, max-age=5", "Netlify-CDN-Cache-Control": "public, s-maxage=5, stale-while-revalidate=10" },
  });
});

async function load() {
  const all = await getMarkets();
  const markets = await Promise.all(
    BASE_MARKETS.map(async (b) => {
      const m = all.find((x) => x.index === b.pairIndex);
      const price = await getSignedPrice(b.pairIndex).catch(() => null);
      return {
        ...b,
        available: !!m && m.listed && !m.closeOnly,
        marketOpen: m?.marketOpen ?? false,
        price: price?.price ?? null,
        terms: m ? marketTerms(m) : null,
        carryPctPerHour: m ? (b.buy ? m.carryPctPerHour.long : m.carryPctPerHour.short) : null,
      };
    })
  );
  return { markets };
}
