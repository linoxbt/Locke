import { NextResponse } from "next/server";
import { BASE_MARKETS } from "@/lib/base/contracts";
import { clientIp, route } from "@/lib/server/http";
import { ipBucket, rateLimit } from "@/lib/server/rateLimit";
import { getSignedPrice } from "@/lib/veranta/client";

/** Every stock's last price, for the stock picker. One read of Veranta's feed serves everyone for 30 s. */
const TTL_MS = 30_000;
const CONCURRENCY = 8;
const PER_PRICE_MS = 4_000;
let cached: { at: number; body: Promise<{ prices: Record<number, { price: number; at: string }> }> } | null = null;

async function load() {
  const pairs = BASE_MARKETS.filter((m) => m.type === "stocks").map((m) => m.pairIndex);
  const prices: Record<number, { price: number; at: string }> = {};
  let next = 0;
  const worker = async () => {
    while (next < pairs.length) {
      const p = pairs[next++];
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), PER_PRICE_MS));
      const got = await Promise.race([getSignedPrice(p, { forDisplay: true }).catch(() => null), timeout]);
      if (got) prices[p] = { price: got.price, at: new Date(got.publishedAt || Date.now()).toISOString() };
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { prices };
}

export const GET = route(async (req: Request) => {
  rateLimit(`${ipBucket(clientIp(req)) ?? "anon"}:base-prices`, 30);
  if (!cached || Date.now() - cached.at > TTL_MS) {
    const body = load();
    cached = { at: Date.now(), body };
    body.catch(() => (cached = null));
  }
  return NextResponse.json(await cached.body, {
    headers: { "Cache-Control": "public, max-age=30", "Netlify-CDN-Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
  });
});
