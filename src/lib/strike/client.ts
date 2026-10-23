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

async function serverNow(): Promise<number> {
  if (Date.now() - clockCheckedAt > 5 * 60_000) {
    try {
      const t0 = Date.now();
      const r = await fetch(`${config.strikeApiUrl}/v2/time`, { cache: "no-store" });
      const { serverTime } = (await r.json()) as { serverTime: number };
      const t1 = Date.now();
      clockOffsetMs = serverTime - (t0 + t1) / 2;
      clockCheckedAt = t1;
    } catch {
      // Keep the previous offset; NTP-synced hosts are within the 3-minute window anyway.
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
  const res = await fetch(`${config.strikeApiUrl}${path}`, { cache: "no-store" });
  return parse(res, `GET ${path.split("?")[0]}`);
}

async function publicPost(path: string, body: object): Promise<any> {
  const res = await fetch(`${config.strikeApiUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
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
    const res = await fetch(`${config.strikeApiUrl}${path}`, {
      method,
      headers,
      body: bodyStr || undefined,
      cache: "no-store",
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
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
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
  });
}

/** Visible order book (full depth Strike returns), as numbers. `fresh` skips the 2 s cache: use it right before an order. */
export async function getOrderBook(symbol: string, opts: { fresh?: boolean } = {}): Promise<OrderBook> {
  const load = async () => {
    const d = await publicGet(`/price/v2/depth?symbol=${encodeURIComponent(symbol)}&limit=1000`);
    const levels = (rows: unknown): BookLevel[] =>
      Array.isArray(rows) ? rows.map((r) => [parseFloat(r[0]), parseFloat(r[1])] as BookLevel).filter(([p, q]) => p > 0 && q > 0) : [];
    return { bids: levels(d.bids), asks: levels(d.asks) };
  };
  return opts.fresh ? load() : cached(`depth:${symbol}`, 2_000, load);
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
  return {
    symbol,
    stepSize: parseFloat(lot.stepSize ?? "1"),
    minQty: parseFloat(lot.minQty ?? "0"),
    minNotional: parseFloat(filter("MIN_NOTIONAL").notional ?? "10"),
    tiers,
  };
}

export async function getFeeRates(): Promise<FeeRates> {
  const tiers = await cached("feeTiers", 10 * 60_000, () => publicGet("/v2/fee-tiers")).catch(() => null);
  const t0 = tiers?.feeTiers?.find((t: any) => t.Tier === 0);
  return { takerRate: t0?.TakerRate ?? 0.0005, builderBps: config.builderFeeBps };
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
  const d = await strikeRequest(keys, "GET", "/v2/history/transaction?type=1&limit=50");
  return d.transactions ?? [];
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
