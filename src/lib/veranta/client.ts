// Veranta read client for the server and the keeper: the market catalogue, a
// vault's positions and the signed price a keeper posts with a margin top-up. Writes go through
// the vault contract, never straight to Veranta.

import { config } from "../server/config";
import {
  IncompletePositionError,
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

/** Veranta's catalogue answered, without this market: it was delisted (or never listed). */
export class UnlistedMarketError extends VerantaError {}

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
  if (!m) throw new UnlistedMarketError(`Veranta has no market ${symbolOrIndex}`, 404, null);
  return m;
}

/** A vault's open positions as Veranta reports them (with its liquidation price and accrued fees). */
/**
 * With `pairIndex`, an incomplete entry for another pair is left out rather than failing the
 * read: one bad record mustn't stop the keeper tending this pair's hedge.
 */
export async function getPositions(trader: string, opts: { pairIndex?: number } = {}): Promise<VerantaPosition[]> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(trader)) throw new VerantaError("Not an address", 400, null);
  const body = await getJson(`${config.verantaApiUrl}/core/user-data?trader=${trader}`, "Veranta positions");
  // An answer without a positions list is an error, never "no positions": reading it as empty
  // would let a glitch look like a closed hedge.
  const raw = body?.positions ?? body?.data?.positions;
  if (!Array.isArray(raw)) throw new VerantaError("Veranta positions: unexpected response", 502, body);
  const out: VerantaPosition[] = [];
  for (const r of raw as RawPosition[]) {
    try {
      out.push(parsePosition(r));
    } catch (e) {
      if (!(e instanceof IncompletePositionError)) throw e;
      if (opts.pairIndex === undefined || Number(r.pairIndex) === opts.pairIndex) throw new VerantaError(e.message, 502, body);
    }
  }
  return out;
}

export interface SignedPrice {
  /** Mid price (USD). */
  price: number;
  /** Signed Pyth Lazer update, posted with a margin top-up (price sourcing 1). */
  updateData: `0x${string}`;
  publishedAt: number;
}

/** A signed price older than this is treated as no price: the market is closed or the feed stalled. */
export const PRICE_MAX_AGE_MS = 60_000;

/**
 * The signed price Veranta's keepers post for a pair; null while its market is closed, and when
 * the answer has no usable price or a stale one, so nothing is sized or sent on it.
 */
export async function getSignedPrice(pairIndex: number, opts: { forDisplay?: boolean } = {}): Promise<SignedPrice | null> {
  const body = await getJson(`${config.verantaFeedUrl}/v2/pairs/${pairIndex}/price-update-data`, "Veranta price");
  const pro = body?.pro ?? body?.data?.pro;
  return readSignedPrice(pro, Date.now(), opts.forDisplay ? Infinity : PRICE_MAX_AGE_MS);
}

/** A price shown to people may be older (it says when it is from); one acted on may not. */
export function readSignedPrice(
  pro: { price?: unknown; priceUpdateData?: unknown; publishTimestampMs?: unknown } | null | undefined,
  now = Date.now(),
  maxAgeMs = PRICE_MAX_AGE_MS
): SignedPrice | null {
  if (!pro || typeof pro.priceUpdateData !== "string" || !/^0x[0-9a-fA-F]+$/.test(pro.priceUpdateData)) return null;
  const price = Number(pro.price);
  const publishedAt = Number(pro.publishTimestampMs);
  if (!Number.isFinite(price) || price <= 0) return null;
  if (maxAgeMs !== Infinity && (!Number.isFinite(publishedAt) || now - publishedAt > maxAgeMs)) return null;
  return { price, updateData: pro.priceUpdateData as `0x${string}`, publishedAt };
}
