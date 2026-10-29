import { NextResponse } from "next/server";
import { BASE_MARKETS } from "@/lib/base/contracts";
import { marketTerms } from "@/lib/server/baseVaults";
import { route } from "@/lib/server/http";
import { getMarkets, getSignedPrice } from "@/lib/veranta/client";

/** The markets Locke offers on Base, with Veranta's live terms and price, for the plan form. */
export const GET = route(async () => {
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
  return NextResponse.json({ markets }, { headers: { "Cache-Control": "public, max-age=10" } });
});
