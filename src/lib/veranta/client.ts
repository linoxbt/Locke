// Veranta (formerly Avantis) read client for the server and the keeper: the market catalogue, a
// vault's positions and the signed price a keeper posts with a margin top-up. Writes go through
// the vault contract, never straight to Veranta.

import { config } from "../server/config";
import {
  parseMarkets,
  parsePosition,
  type RawPosition,
  type RawTradingSnapshot,
  type VerantaMarket,
  type VerantaPosition,
} from "../domain/veranta";

export class VerantaError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown
  ) {
    super(message);
  }
}

/** Every Veranta call gives up after this long, so one hung request can't stall a route or the keeper. */
const TIMEOUT_MS = 10_000;
/** The catalogue (fees, funding, open interest, market hours) is re-read at most this often. */
const MARKETS_TTL_MS = 10_000;

async function getJson(url: string, what: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new VerantaError(timedOut ? "Veranta didn't answer in time" : "Veranta is unreachable", timedOut ? 504 : 503, null);
  }
  const text = await res.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON */
  }
  if (!res.ok) throw new VerantaError(`${what} failed (${res.status})`, res.status, body);
  return body;
}

let marketsCache: { at: number; markets: VerantaMarket[] } | null = null;

/** Every Veranta market with its fees, carry, limits and whether it is open now. */
export async function getMarkets(): Promise<VerantaMarket[]> {
  if (marketsCache && Date.now() - marketsCache.at < MARKETS_TTL_MS) return marketsCache.markets;
  const body = await getJson(`${config.verantaApiUrl}/data/v2/trading`, "Veranta markets");
  const snapshot = (body?.data ?? body) as RawTradingSnapshot;
  if (!snapshot?.pairInfos) throw new VerantaError("Veranta markets: unexpected response", 502, body);
  const markets = parseMarkets(snapshot);
  marketsCache = { at: Date.now(), markets };
  return markets;
}

export async function getMarket(symbolOrIndex: string | number): Promise<VerantaMarket> {
  const markets = await getMarkets();
  const m =
    typeof symbolOrIndex === "number"
      ? markets.find((x) => x.index === symbolOrIndex)
      : markets.find((x) => x.symbol.toUpperCase() === symbolOrIndex.toUpperCase());
  if (!m) throw new VerantaError(`Veranta has no market ${symbolOrIndex}`, 404, null);
  return m;
}

/** A vault's open positions as Veranta reports them (with its liquidation price and accrued fees). */
export async function getPositions(trader: string): Promise<VerantaPosition[]> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(trader)) throw new VerantaError("Not an address", 400, null);
  const body = await getJson(`${config.verantaApiUrl}/core/user-data?trader=${trader}`, "Veranta positions");
  const raw = (body?.positions ?? body?.data?.positions ?? []) as RawPosition[];
  return raw.map(parsePosition);
}

export interface SignedPrice {
  /** Mid price (USD). */
  price: number;
  /** Signed Pyth Lazer update, posted with a margin top-up (price sourcing 1). */
  updateData: `0x${string}`;
  publishedAt: number;
}

/** The signed price Veranta's keepers post for a pair; null while its market is closed. */
export async function getSignedPrice(pairIndex: number): Promise<SignedPrice | null> {
  const body = await getJson(`${config.verantaFeedUrl}/v2/pairs/${pairIndex}/price-update-data`, "Veranta price");
  const pro = body?.pro ?? body?.data?.pro;
  if (!pro?.priceUpdateData) return null;
  return { price: Number(pro.price), updateData: pro.priceUpdateData, publishedAt: Number(pro.publishTimestampMs) };
}
