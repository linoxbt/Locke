// Coinbase's tokenized stocks on Base (B20 tokens), read for the signed-in account so a stock plan
// can be sized from what the business actually holds. The token list is public reference data
// (api.coinbase.com/v1/tokenized-stocks, no key); balances are read on Base; values use Veranta's
// price for the same stock. Shown only as a convenience: a plan works for shares held anywhere.

import { erc20Abi as viemErc20, getAddress, type Address } from "viem";
import { BASE_MARKETS } from "../base/contracts";
import { getSignedPrice } from "../veranta/client";
import { basePublicClient } from "./baseChain";

const LIST_URL = "https://api.coinbase.com/v1/tokenized-stocks";
const LIST_TTL_MS = 60 * 60_000;

interface ListedToken {
  contract_address: string;
  symbol: string;
  decimals: number;
  multiplier?: number;
  paused_features?: unknown;
}

let listCache: { at: number; tokens: ListedToken[] } | null = null;

/** The tokenized stocks Locke can hedge, from Coinbase's list (cached for an hour). */
async function hedgeableTokens(): Promise<(ListedToken & { pairIndex: number })[]> {
  if (!listCache || Date.now() - listCache.at > LIST_TTL_MS) {
    const tokens: ListedToken[] = [];
    let page: string | undefined;
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${LIST_URL}?page_size=500${page ? `&page_token=${encodeURIComponent(page)}` : ""}`, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
      if (!res.ok) throw new Error(`tokenized stock list: ${res.status}`);
      const body = (await res.json()) as { tokens?: ListedToken[]; next_page_token?: string };
      tokens.push(...(body.tokens ?? []));
      if (!body.next_page_token) break;
      page = body.next_page_token;
    }
    listCache = { at: Date.now(), tokens };
  }
  const bySymbol = new Map(listCache.tokens.map((t) => [t.symbol, t]));
  return BASE_MARKETS.flatMap((m) => {
    const sym = "token" in m ? m.token : undefined;
    const t = sym ? bySymbol.get(sym) : undefined;
    return t && /^0x[0-9a-fA-F]{40}$/.test(t.contract_address) ? [{ ...t, pairIndex: m.pairIndex }] : [];
  });
}

export interface HeldStock {
  token: string;
  pairIndex: number;
  shares: number;
  valueUsd: number;
}

/** Tokenized stocks this address holds on Base worth at least $1, largest first. */
export async function heldStocks(owner: string): Promise<HeldStock[]> {
  const tokens = await hedgeableTokens();
  if (!tokens.length) return [];
  const client = basePublicClient();
  const balances = await Promise.all(
    tokens.map((t) => client.readContract({ address: getAddress(t.contract_address), abi: viemErc20, functionName: "balanceOf", args: [getAddress(owner) as Address] }).catch(() => 0n))
  );
  const held = tokens.map((t, i) => ({ t, raw: balances[i] })).filter((x) => x.raw > 0n);
  const out = await Promise.all(
    held.map(async ({ t, raw }) => {
      const price = await getSignedPrice(t.pairIndex, { forDisplay: true }).catch(() => null);
      const shares = (Number(raw) / 10 ** t.decimals) * (Number(t.multiplier) || 1);
      return { token: t.symbol, pairIndex: t.pairIndex, shares, valueUsd: price ? shares * price.price : 0 };
    })
  );
  return out.filter((h) => h.valueUsd >= 1).sort((a, b) => b.valueUsd - a.valueUsd);
}
