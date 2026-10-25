// Strike REST client for the server and the risk worker.
// Every authenticated call is signed with the user's builder-connected API wallet.

import { config } from "../server/config";
import type { BookLevel, OrderBook } from "../domain/liquidity";
import type { FeeRates, MarginTier, MarketRules } from "../domain/types";
import { signRequestHeaders } from "./sign";

export class StrikeError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown
  ) {
    super(message);
  }
}

export interface ApiKeys {
  publicKey: string;
  privateKey: string;
  /** Builder fee share the user approved when connecting; orders never carry more. */
  feeShareBps?: number;
}

// ── Clock ──
let clockOffsetMs = 0;
let clockCheckedAt = 0;

/** Every Strike call gives up after this long, so one hung request can't stall a route or the worker. */
const TIMEOUT_MS = 10_000;

async function strikeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { cache: "no-store", ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new StrikeError(timedOut ? "Strike didn't answer in time" : "Strike is unreachable", timedOut ? 504 : 503, null);
  }
}

/** Strike's clock (ms), for signing. Falls back to the local clock if /v2/time misbehaves. */
export async function serverNow(): Promise<number> {
  if (Date.now() - clockCheckedAt > 5 * 60_000) {
    try {
      const t0 = Date.now();
      const r = await strikeFetch(`${config.strikeApiUrl}/v2/time`);
      const body = (await r.json()) as { serverTime?: unknown };
      const t1 = Date.now();
      const serverTime = Number(body.serverTime);
      // Only accept a sane millisecond timestamp within a day of ours; anything else keeps the old offset.
      if (r.ok && Number.isFinite(serverTime) && Math.abs(serverTime - t1) < 86_400_000) {
        clockOffsetMs = serverTime - (t0 + t1) / 2;
      }
      clockCheckedAt = t1;
    } catch {
      // Keep the previous offset; NTP-synced hosts are within the 3-minute window anyway.
      clockCheckedAt = Date.now();
    }
  }
  return Date.now() + clockOffsetMs;
}

async function parse(res: Response, what: string): Promise<any> {
  const text = await res.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const msg = (body && typeof body === "object" && (body.error || body.message)) || `${what} failed (${res.status})`;
    throw new StrikeError(String(msg), res.status, body);
  }
  return body;
}

async function publicGet(path: string): Promise<any> {
  const res = await strikeFetch(`${config.strikeApiUrl}${path}`);
  return parse(res, `GET ${path.split("?")[0]}`);
}

async function publicPost(path: string, body: object): Promise<any> {
  const res = await strikeFetch(`${config.strikeApiUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parse(res, `POST ${path}`);
}

/** Authenticated call. The body is serialised once and those exact bytes are signed and sent. */
export async function strikeRequest(
  keys: ApiKeys,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: object,
  extraHeaders?: Record<string, string>
): Promise<any> {
  const bodyStr = method !== "GET" && body !== undefined ? JSON.stringify(body) : "";
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = {
      ...signRequestHeaders(method, path, bodyStr, keys, await serverNow()),
      ...extraHeaders,
    };
    if (bodyStr) headers["Content-Type"] = "application/json";
    const res = await strikeFetch(`${config.strikeApiUrl}${path}`, {
      method,
      headers,
      body: bodyStr || undefined,
    });
    // Strike answers 401 "authentication failed" for a bad signature too; nothing ran,
    // so one retry with a fresh timestamp and nonce is safe.
    if (res.status === 401 && attempt === 0) {
      clockCheckedAt = 0;
      continue;
    }
    return parse(res, `${method} ${path.split("?")[0]}`);
  }
}

// ── Builder connect (public) ──

/**
 * Strike's connect refusals, in words a business owner can act on. Strike won't connect the
 * account that registered a builder code through that same code, so the builder's own wallet
 * has to use a different wallet to sign in.
 */
function explainConnectError(e: unknown): never {
  if (e instanceof StrikeError && /own builder code/i.test(e.message)) {
    throw new StrikeError(
      "This wallet registered Locke's builder code, and Strike doesn't let a builder connect through its own code. Sign in with a different wallet or account.",
      409,
      e.body
    );
  }
  throw e;
}

export function requestBuilderSignature(p: {
  address: string;
  publicKey: string;
  feeShareBps: number;
}): Promise<{ nonce: string; message_to_sign: string }> {
  return publicPost("/auth/builder/request-signature", {
    address: p.address,
    chain: "cardano",
    code: config.builderCode,
    fee_share_bps: p.feeShareBps,
    public_key: p.publicKey,
  }).catch(explainConnectError);
}

export function verifyBuilderSignature(p: { nonce: string; walletSignature: string }): Promise<{
  account_id: string;
  api_wallet_public_key: string;
  api_wallet_expired_at?: number | string;
  fee_share_bps?: number;
}> {
  return publicPost("/auth/builder/verify-signature", { nonce: p.nonce, wallet_signature: p.walletSignature }).catch(explainConnectError);
}

// ── Market data (public, cached) ──

const cache = new Map<string, { at: number; value: unknown }>();
const loading = new Map<string, Promise<unknown>>();
/** How long an expired entry may still be served when a refresh fails (Strike briefly down). */
const STALE_OK_MS = 30 * 60_000;
/**
 * Prices and books go stale fast: past this, a failed refresh throws, so a margin ratio, a fill
 * check or a deposit is never worked out from a mark minutes old and shown as live.
 */
const PRICE_STALE_OK_MS = 15_000;

/** Cached loader: concurrent callers share one request, and a failed refresh serves the last value for up to `staleOkMs`. */
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>, staleOkMs = STALE_OK_MS): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  let p = loading.get(key) as Promise<T> | undefined;
  if (!p) {
    p = load()
      .then((value) => {
        cache.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => loading.delete(key));
    loading.set(key, p);
  }
  try {
    return await p;
  } catch (e) {
    if (hit && Date.now() - hit.at < ttlMs + staleOkMs) return hit.value as T;
    throw e;
  }
}

export interface MarkPrice {
  symbol: string;
  mark: number;
  index: number;
  /** Hourly funding rate (decimal). */
  fundingRate: number;
  nextFundingTime: number;
}

export async function getMarkPrice(symbol: string): Promise<MarkPrice> {
  return cached(`mark:${symbol}`, 2_000, async () => {
    const d = await publicGet(`/price/v2/markPrice?symbol=${encodeURIComponent(symbol)}`);
    return {
      symbol,
      mark: parseFloat(d.p),
      index: parseFloat(d.i),
      fundingRate: parseFloat(d.r),
      nextFundingTime: d.T,
    };
  }, PRICE_STALE_OK_MS);
}

/** Visible order book (full depth Strike returns), as numbers. `fresh` skips the 2 s cache: use it right before an order. */
export async function getOrderBook(symbol: string, opts: { fresh?: boolean } = {}): Promise<OrderBook> {
  const load = async () => {
    const d = await publicGet(`/price/v2/depth?symbol=${encodeURIComponent(symbol)}&limit=1000`);
    const levels = (rows: unknown): BookLevel[] =>
      Array.isArray(rows) ? rows.map((r) => [parseFloat(r[0]), parseFloat(r[1])] as BookLevel).filter(([p, q]) => p > 0 && q > 0) : [];
    return { bids: levels(d.bids), asks: levels(d.asks) };
  };
  return opts.fresh ? load() : cached(`depth:${symbol}`, 2_000, load, PRICE_STALE_OK_MS);
}

export async function getMarketRules(symbol: string): Promise<MarketRules> {
  const [info, markets] = await Promise.all([
    cached("exchangeInfo", 10 * 60_000, () => publicGet("/price/v2/exchangeInfo")),
    cached("markets", 10 * 60_000, () => publicGet("/v2/markets")),
  ]);
  const s = (info.symbols as any[]).find((x) => x.symbol === symbol);
  if (!s || s.status !== "trading") throw new StrikeError(`${symbol} is not trading on Strike`, 503, null);
  const filter = (t: string) => (s.filters as any[]).find((f) => f.filterType === t) ?? {};
  const lot = filter("MARKET_LOT_SIZE").stepSize ? filter("MARKET_LOT_SIZE") : filter("LOT_SIZE");
  const tiers: MarginTier[] = markets.markets?.[symbol]?.margin_tiers ?? [];
  const maxQty = parseFloat(lot.maxQty);
  return {
    symbol,
    stepSize: parseFloat(lot.stepSize ?? "1"),
    minQty: parseFloat(lot.minQty ?? "0"),
    minNotional: parseFloat(filter("MIN_NOTIONAL").notional ?? "10"),
    maxQty: Number.isFinite(maxQty) && maxQty > 0 ? maxQty : undefined,
    tiers,
  };
}

/** Taker fee plus the builder fee; `builderBps` overrides the server setting (a user's approved cap). */
export async function getFeeRates(builderBps: number = config.builderFeeBps): Promise<FeeRates> {
  const tiers = await cached("feeTiers", 10 * 60_000, () => publicGet("/v2/fee-tiers")).catch(() => null);
  const t0 = tiers?.feeTiers?.find((t: any) => t.Tier === 0);
  // Coerce: a string here would turn every fee sum into string concatenation.
  const taker = Number(t0?.TakerRate);
  return { takerRate: Number.isFinite(taker) && taker >= 0 && taker < 0.01 ? taker : 0.0005, builderBps };
}

/** Daily mark closes. */
export async function getDailyCloses(symbol: string, days: number): Promise<{ t: number; close: number }[]> {
  const end = Date.now();
  const start = end - days * 86_400_000;
  const qs = new URLSearchParams({
    symbol,
    interval: "1d",
    priceType: "mark",
    startTime: String(start),
    endTime: String(end),
    limit: String(Math.min(1500, days + 2)),
  });
  const rows = await cached(`klines:${symbol}:${days}`, 10 * 60_000, () => publicGet(`/price/v2/klines?${qs}`));
  return (Array.isArray(rows) ? rows : []).map((r: any[]) => ({ t: Number(r[0]), close: parseFloat(r[4]) }));
}

// ── Account, positions, orders (authenticated) ──

export interface StrikePosition {
  symbol: string;
  margin_mode: "cross" | "isolated";
  leverage: number;
  size: string;
  entry_price: string;
  iso_balance: string;
  accumulated_funding_fees: string;
  upnl: string;
  maintenance_margin: string;
  liquidation_price: string;
  id: number;
}

export async function getAccount(keys: ApiKeys): Promise<{ wallet_balance: string; available_balance: string }> {
  return strikeRequest(keys, "GET", "/v2/account");
}

export async function getPosition(keys: ApiKeys, symbol: string): Promise<StrikePosition | null> {
  const d = await strikeRequest(keys, "GET", `/v2/positions?symbol=${encodeURIComponent(symbol)}`);
  const p = (d.positions ?? []).find((x: StrikePosition) => x.symbol === symbol && parseFloat(x.size) !== 0);
  return p ?? null;
}

export async function getPositions(keys: ApiKeys): Promise<StrikePosition[]> {
  const d = await strikeRequest(keys, "GET", "/v2/positions");
  return (d.positions ?? []).filter((x: StrikePosition) => parseFloat(x.size) !== 0);
}

export function setMarginMode(keys: ApiKeys, symbol: string, mode: "isolated" | "cross") {
  return strikeRequest(keys, "POST", "/v2/marginMode", { symbol, marginMode: mode });
}

export function setLeverage(keys: ApiKeys, symbol: string, leverage: number) {
  return strikeRequest(keys, "POST", "/v2/leverage", { symbol, leverage });
}

export function placeMarketOrder(
  keys: ApiKeys,
  o: { symbol: string; side: "buy" | "sell"; size: string; clientOrderId: string; reduceOnly?: boolean; closePosition?: boolean }
) {
  const body: Record<string, unknown> = {
    client_order_id: o.clientOrderId,
    symbol: o.symbol,
    side: o.side,
    type: "market",
    size: o.size,
  };
  if (o.reduceOnly) body.reduce_only = true;
  if (o.closePosition) body.close_position = true;
  // The server's fee, capped at what this user approved (the setting may have been raised since).
  const bps = Math.min(config.builderFeeBps, keys.feeShareBps ?? config.builderFeeBps);
  return strikeRequest(keys, "POST", "/v2/order", body, bps > 0 ? { "X-Builder-Fee-Bps": String(bps) } : undefined);
}

export interface StrikeOrder {
  ClientOrderID: string;
  Status: "pending" | "open" | "filled" | "canceled" | "untriggered" | "rejected" | "expired" | "none";
  Size: string;
  Filled: string;
  CloseReason?: string;
}

/** An order by its client id, or null when Strike has no such order (it was never accepted). */
export async function getOrderByClientId(keys: ApiKeys, symbol: string, clientOrderId: string): Promise<StrikeOrder | null> {
  try {
    const qs = new URLSearchParams({ symbol, client_order_id: clientOrderId });
    const o = (await strikeRequest(keys, "GET", `/v2/order?${qs}`)) as StrikeOrder;
    return o && o.Status && o.Status !== "none" ? o : null;
  } catch (e) {
    if (e instanceof StrikeError && e.status === 404) return null;
    throw e;
  }
}

export function addIsolatedMargin(keys: ApiKeys, symbol: string, amountUsd: number) {
  return strikeRequest(keys, "POST", "/v2/isoMargin", {
    symbol,
    amount: amountUsd.toFixed(2),
    modify_type: "add",
  });
}

export function depositQuote(keys: ApiKeys, lovelace: bigint) {
  return strikeRequest(keys, "POST", "/v2/deposit/quote", {
    blockchain: "cardano",
    asset_symbol: "ADA",
    asset_amount: lovelace.toString(),
  }) as Promise<{ request_id: string; quote: { usd_value: string; expiration_at: number } }>;
}

export function depositBuildTx(keys: ApiKeys, requestId: string, userAddress: string, utxos: string[]) {
  return strikeRequest(keys, "POST", "/v2/deposit/build-tx", {
    request_id: requestId,
    user_address: userAddress,
    utxos,
  }) as Promise<{ unsigned_tx: string; format: string; expires_at: number }>;
}

export function depositConfirm(keys: ApiKeys, requestId: string, txHash: string) {
  return strikeRequest(keys, "POST", "/v2/deposit", { request_id: requestId, tx_hash: txHash });
}

export interface StrikeTransaction {
  id: number;
  type: string;
  amount: string;
  tx_hash: string | null;
  status: string;
  timestamp: number;
  request_id?: string;
}

export async function getDepositHistory(keys: ApiKeys): Promise<StrikeTransaction[]> {
  // Enough history to cover every deposit Locke still waits on (rows expire after 6 hours).
  const d = await strikeRequest(keys, "GET", "/v2/history/transaction?type=1&limit=200");
  return d.transactions ?? [];
}

export interface StrikeFill {
  order_id: string;
  symbol: string;
  side: string;
  price: string;
  size: string;
  realized_pnl: string;
  fee: string;
  /** none, commission, liquidation or funding. */
  fee_type: string;
  liquidation_fee?: string;
  client_order_id?: string;
  /** Set on Strike's forced closes (liquidation, ADL). */
  auto_close_type?: string;
  timestamp: number;
}

/** This account's fills on one market since `startTime` (Unix ms), newest first. Realized P&L and fees live here. */
export async function getFills(keys: ApiKeys, symbol: string, startTime: number): Promise<StrikeFill[]> {
  const start = Math.floor(startTime);
  return cached(`fills:${keys.publicKey}:${symbol}:${start}`, 10_000, async () => {
    const d = await strikeRequest(keys, "GET", `/v2/history/fill?symbol=${encodeURIComponent(symbol)}&startTime=${start}&limit=1000`);
    return (d.fills ?? []) as StrikeFill[];
  });
}

export async function getSymbolSetting(
  keys: ApiKeys,
  symbol: string
): Promise<{ margin_mode: "cross" | "isolated"; leverage: number } | null> {
  const d = await strikeRequest(keys, "GET", "/v2/symbols");
  return d.symbol_settings?.[symbol] ?? null;
}

export function withdrawQuote(keys: ApiKeys, usdValue: number, walletAddress: string) {
  return strikeRequest(keys, "POST", "/v2/withdraw/quote", {
    usd_value: usdValue.toFixed(2),
    blockchain: "cardano",
    asset: "ADA",
    wallet_address: walletAddress,
  }) as Promise<{ withdraw_id: string; fee: string; message_to_sign: string; tx_cbor?: string; estimated_receive?: string }>;
}

export function withdrawConfirm(keys: ApiKeys, withdrawId: string, walletSignature: string, signedTxCbor?: string) {
  const body: Record<string, string> = { withdraw_id: withdrawId, wallet_signature: walletSignature };
  if (signedTxCbor) body.signed_tx_cbor = signedTxCbor;
  return strikeRequest(keys, "POST", "/v2/withdraw", body);
}
