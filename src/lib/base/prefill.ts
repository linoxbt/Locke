// "Protect this position" links: another app (an exchange, a wallet, an agent) opens Locke's plan
// form already filled in, e.g. /protect/stocks?asset=NVDA&value=5000&ref=o1. Everything is optional
// and checked; anything out of range is ignored, and the person still reviews and signs.

import { BASE_MARKETS, type BasePlanType } from "./contracts";
import { OIL_PRODUCTS, type OilProduct } from "../domain/basePlans";

export interface Prefill {
  pairIndex?: number;
  /** USD value held (stocks, holdings). */
  valueUsd?: number;
  /** Number of shares or coins held; turned into a value once the price is known. */
  units?: number;
  sharePct?: number;
  product?: OilProduct;
  monthlySpendUsd?: number;
  months?: number;
  /** Who sent the person here, e.g. "o1". Kept with the plan for attribution. */
  ref?: string;
}

const num = (v: string | null, min: number, max: number) => {
  if (v == null || v.trim() === "") return undefined;
  const n = Number(v.replace(/[,_\s$]/g, ""));
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

/** Read a link's query string for a plan of this type. Markets of another type are ignored. */
export function readPrefill(search: string, type: BasePlanType): Prefill {
  const q = new URLSearchParams(search);
  const out: Prefill = {};
  // The market, by ticker (NVDA, ETH, WTI), symbol (NVDA/USD), tokenized-stock token (NVDAc) or index.
  const key = (q.get("asset") ?? q.get("market") ?? q.get("symbol") ?? q.get("token") ?? "").trim().toUpperCase();
  const byKey = key
    ? BASE_MARKETS.find((m) => m.type === type && (m.asset === key || m.symbol === key || m.symbol === `${key}/USD` || ("token" in m && m.token?.toUpperCase() === key)))
    : undefined;
  const pair = num(q.get("pair"), 0, 10_000);
  const byPair = pair != null ? BASE_MARKETS.find((m) => m.type === type && m.pairIndex === pair) : undefined;
  const market = byKey ?? byPair;
  if (market) out.pairIndex = market.pairIndex;

  if (type === "costs") {
    const p = (q.get("product") ?? "").trim().toLowerCase();
    if (OIL_PRODUCTS.some((x) => x.id === p)) out.product = p as OilProduct;
    out.monthlySpendUsd = num(q.get("monthly") ?? q.get("monthlySpendUsd"), 1, 10_000_000);
    const months = num(q.get("months"), 1, 6);
    if (months != null) out.months = Math.round(months);
  } else {
    out.valueUsd = num(q.get("value") ?? q.get("valueUsd"), 1, 10_000_000);
    out.units = num(q.get("shares") ?? q.get("amount") ?? q.get("units"), 0.000001, 1e12);
    const share = num(q.get("share") ?? q.get("sharePct"), 10, 100);
    if (share != null) out.sharePct = Math.round(share / 5) * 5;
  }
  const ref = (q.get("ref") ?? "").trim().toLowerCase();
  if (/^[a-z0-9][a-z0-9._-]{1,31}$/.test(ref)) out.ref = ref;
  for (const k of Object.keys(out) as (keyof Prefill)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/** The link another app puts on its "Protect this position" button. */
export function protectLink(site: string, type: BasePlanType, p: { asset?: string; value?: number; shares?: number; share?: number; ref?: string }): string {
  const q = new URLSearchParams();
  if (p.asset) q.set("asset", p.asset);
  if (p.value != null) q.set("value", String(p.value));
  if (p.shares != null) q.set("shares", String(p.shares));
  if (p.share != null) q.set("share", String(p.share));
  if (p.ref) q.set("ref", p.ref);
  return `${site.replace(/\/$/, "")}/protect/${type}${q.size ? `?${q}` : ""}`;
}
