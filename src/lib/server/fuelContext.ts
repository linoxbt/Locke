// Live inputs for the fuel form: WTI now and about 90 days ago (Strike), and each supported
// currency's dollar rate now and 90 days ago. Rates come from the open fawazahmed0 currency API
// (daily, served from jsDelivr with a Cloudflare mirror). Cached for an hour.

import { COUNTRIES } from "../domain/fuel";
import { getDailyCloses, getMarkPrice } from "../strike/client";

const DAY = 86_400_000;
const AGO_DAYS = 90;
const CURRENCIES = Object.values(COUNTRIES).map((c) => c.currency.toLowerCase());

export interface FuelContext {
  wti: { now: number; ago: number | null; agoDate: string | null };
  fx: { date: string; agoDate: string; rates: Record<string, { now: number; ago: number | null }> } | null;
}

let cache: { at: number; value: FuelContext } | null = null;

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

async function usdRates(date: string): Promise<{ date: string; usd: Record<string, number> }> {
  const urls = [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.min.json`,
    `https://${date}.currency-api.pages.dev/v1/currencies/usd.min.json`,
  ];
  let last: unknown;
  for (const url of urls) {
    try {
      const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6_000) });
      if (r.ok) return (await r.json()) as { date: string; usd: Record<string, number> };
      last = new Error(`${r.status} from ${new URL(url).host}`);
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("Exchange rates unavailable");
}

export async function fuelContext(): Promise<FuelContext> {
  if (cache && Date.now() - cache.at < 60 * 60_000) return cache.value;
  const agoT = Date.now() - AGO_DAYS * DAY;

  const [mark, closes, now, ago] = await Promise.all([
    getMarkPrice("WTI-USD"),
    getDailyCloses("WTI-USD", AGO_DAYS + 10).catch(() => []),
    usdRates("latest").catch(() => null),
    usdRates(isoDay(agoT)).catch(() => null),
  ]);

  // The daily close nearest to 90 days ago.
  const near = closes.reduce<{ t: number; close: number } | null>(
    (best, c) => (!best || Math.abs(c.t - agoT) < Math.abs(best.t - agoT) ? c : best),
    null
  );

  const value: FuelContext = {
    wti: { now: mark.mark, ago: near?.close ?? null, agoDate: near ? isoDay(near.t) : null },
    fx: now
      ? {
          date: now.date,
          agoDate: ago?.date ?? isoDay(agoT),
          rates: Object.fromEntries(
            CURRENCIES.filter((c) => now.usd[c] > 0).map((c) => [c.toUpperCase(), { now: now.usd[c], ago: ago?.usd[c] ?? null }])
          ),
        }
      : null,
  };
  cache = { at: Date.now(), value };
  return value;
}
