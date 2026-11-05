// Public dashboard figures: what Locke protects on Base, from Locke's own records and from the
// factory contract on Base. Aggregates only; nothing here names a business or a wallet.

import { formatEther, type Address } from "viem";
import { BASE_MARKETS, baseMarket, factoryAbi, fromUsdcUnits } from "../base/contracts";
import { basePublicClient } from "./baseChain";
import { config } from "./config";
import { db } from "./db";
import { getSignedPrice } from "../veranta/client";

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

export interface Point {
  /** Day (UTC midnight, ISO) or the start of a week. */
  t: string;
  v: number;
}

export interface Metrics {
  range: RangeDays;
  /** USD of hedges open right now. */
  protectedUsd: number;
  /** Protected value at the start of the range, for the change shown on the tile. */
  protectedAtStart: number;
  /** Plans waiting for a deposit, opening or open. */
  openPlans: number;
  activeHedges: number;
  plansCreated: number;
  plansCreatedInRange: number;
  /** Plans by status (funding, opening, active, closed). */
  byStatus: Record<string, number>;
  /** Active hedges by market: USD and count, in BASE_MARKETS order (stocks only when they have a plan). */
  /** Each market with its last Veranta price (null when it couldn't be read). */
  byMarket: { symbol: string; label: string; type: string; usd: number; plans: number; price: number | null }[];
  /** Active hedge value by plan type. */
  byType: { holdings: number; costs: number; stocks: number };
  /** Daily protected value over the range. */
  protectedSeries: Point[];
  /** Plans created per day (7 and 30 days) or per week (90 days). */
  createdSeries: Point[];
  createdBucket: "day" | "week";
  liveProofs: number;
  builderCodeTxs: number;
  proofs: { uid: string; market: string; protectedUsd: number; at: string }[];
  activity: { message: string; market: string; type: string; level: string; at: string }[];
  /** Read from the factory on Base; null when Base can't be read or Locke isn't live. */
  chain: { depositsUsd: number; capUsd: number; feeBps: number; keeper: string; keeperEth: number } | null;
  /** The keeper's last check-in, seconds ago; null when it has never checked in. */
  keeperAgeS: number | null;
  at: string;
}

const num = (v: unknown) => Number(v ?? 0) || 0;

/**
 * An event as the public page may show it: what happened, never how much a business moved, its
 * income share or its weekly cap. Anything else that names an amount is shown generically.
 */
export function publicMessage(message: string): string {
  const known: [RegExp, string][] = [
    [/^Moved \$/, "Incoming USDC moved into a plan"],
    [/^Protect as you get paid is on/, "Protect as you get paid turned on"],
    [/^Added \$/, "Margin added from a plan's buffer"],
    [/^Hedge sent to Veranta/, "Hedge sent to Veranta"],
    [/^Margin is getting thin/, "A plan needs more margin"],
  ];
  for (const [re, text] of known) if (re.test(message)) return text;
  return /\$\s?\d|\d+%/.test(message) && !/^Margin \d+% used$/.test(message) ? "Plan updated" : message;
}

/** Base reads get this long: past it the page shows "—" for them rather than waiting. */
const CHAIN_TIMEOUT_MS = 4_000;

function within<T>(p: Promise<T>, ms: number, fallback: T, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[metrics] ${what} took over ${ms} ms; showing the page without it`);
      resolve(fallback);
    }, ms);
  });
  return Promise.race([p.finally(() => clearTimeout(timer)), late]);
}

async function chainFigures(): Promise<Metrics["chain"]> {
  const factory = config.baseFactoryAddress;
  if (!factory) return null;
  try {
    const c = basePublicClient();
    const read = (functionName: "totalDeposits" | "maxTotalDeposits" | "feeBps" | "keeper") =>
      c.readContract({ address: factory, abi: factoryAbi, functionName });
    const [deposits, cap, feeBps, keeper] = await Promise.all([read("totalDeposits"), read("maxTotalDeposits"), read("feeBps"), read("keeper")]);
    const keeperWei = await c.getBalance({ address: keeper as Address });
    return {
      depositsUsd: fromUsdcUnits(deposits as bigint),
      capUsd: fromUsdcUnits(cap as bigint),
      feeBps: Number(feeBps),
      keeper: String(keeper).toLowerCase(),
      keeperEth: Number(formatEther(keeperWei)),
    };
  } catch {
    return null;
  }
}

export async function readMetrics(range: RangeDays): Promise<Metrics> {
  const started = Date.now();
  const sql = db();
  const bucket = range > 30 ? "week" : "day";
  const notional = sql`(sizing->>'notionalUsd')::numeric`;
  // Base is read alongside; the database queries run one after another on one connection, because
  // opening several pooled connections at once can stall on the hosted pooler.
  const chainRead = within(chainFigures(), CHAIN_TIMEOUT_MS, null, "Reading the factory on Base");
  const queries = [
    sql`
      select coalesce(sum(${notional}) filter (where status = 'active'), 0) as usd,
             coalesce(sum(${notional}) filter (where opened_at <= now() - make_interval(days => ${range})
                                                and (closed_at is null or closed_at > now() - make_interval(days => ${range}))), 0) as start_usd,
             count(*) filter (where status <> 'closed') as open,
             count(*) filter (where status = 'active') as active,
             count(*) as created,
             count(*) filter (where created_at > now() - make_interval(days => ${range})) as created_in_range
      from base_vaults`,
    sql`select status, count(*) as n from base_vaults group by status`,
    sql`select pair_index, coalesce(sum(${notional}) filter (where status = 'active'), 0) as usd, count(*) as n from base_vaults where status <> 'closed' group by pair_index`,
    sql`select type, coalesce(sum(${notional}), 0) as usd from base_vaults where status = 'active' group by type`,
    // Protected value at the end of each day: hedges opened by then and not yet closed.
    sql`
      select d.day, coalesce(sum(${notional}), 0) as usd
      from generate_series(date_trunc('day', now()) - make_interval(days => ${range - 1}), date_trunc('day', now()), interval '1 day') as d(day)
      left join base_vaults v on v.opened_at < d.day + interval '1 day' and (v.closed_at is null or v.closed_at >= d.day + interval '1 day')
      group by d.day order by d.day`,
    sql`
      select b.t, count(v.address) as n
      from generate_series(date_trunc(${bucket}, now() - make_interval(days => ${range - 1})), date_trunc(${bucket}, now()), ${bucket === "week" ? sql`interval '1 week'` : sql`interval '1 day'`}) as b(t)
      left join base_vaults v on date_trunc(${bucket}, v.created_at) = b.t
      group by b.t order by b.t`,
    // Mined transactions only: a proof still being published, or one that never landed, carries a hash too.
    sql`
      select count(distinct tx) as n from (
        select created_tx as tx from base_vaults
        union select tx_hash from base_vault_events
        where tx_hash is not null and not (detail is not null and (detail ? 'attestTx' or detail->>'failed' = 'true'))
      ) t`,
    // Live proofs: unrevoked, and their vault's hedge still open (a closed vault's may wait to be revoked).
    sql`
      select e.detail->>'attestation' as uid, v.pair_index, v.sizing, e.created_at
      from base_vault_events e join base_vaults v on v.address = e.vault
      where e.detail ? 'attestation' and v.status = 'active'
        and not exists (select 1 from base_vault_events r where r.vault = e.vault and r.detail->>'revoked' = e.detail->>'attestation')
      order by e.id desc limit 6`,
    sql`
      select count(*)::int as n from base_vault_events e join base_vaults v on v.address = e.vault
      where e.detail ? 'attestation' and v.status = 'active'
        and not exists (select 1 from base_vault_events r where r.vault = e.vault and r.detail->>'revoked' = e.detail->>'attestation')`,
    sql`
      select e.message, e.level, e.created_at, v.pair_index, v.type
      from base_vault_events e join base_vaults v on v.address = e.vault
      order by e.id desc limit 8`,
    sql`select extract(epoch from now() - at)::float8 as age from monitor_heartbeat where id = 2`,
  ];
  const results: Record<string, any>[][] = [];
  for (const q of queries) results.push(await q);
  const [[totals], statuses, markets, types, protectedRows, createdRows, [txs], proofs, [live], activity, [beat]] = results;
  const chain = await chainRead;
  const ms = Date.now() - started;
  if (ms > 3_000) console.warn(`[metrics] range ${range} took ${ms} ms`);

  const byStatus: Record<string, number> = { funding: 0, opening: 0, active: 0, closed: 0 };
  for (const s of statuses) byStatus[String(s.status)] = num(s.n);
  const byPair = new Map(markets.map((m) => [Number(m.pair_index), m]));
  // A market appears once a plan is made on it, most protected first.
  const shown = BASE_MARKETS.filter((m) => num(byPair.get(m.pairIndex)?.n) > 0).sort(
    (a, b) => num(byPair.get(b.pairIndex)?.usd) - num(byPair.get(a.pairIndex)?.usd) || num(byPair.get(b.pairIndex)?.n) - num(byPair.get(a.pairIndex)?.n)
  );
  const prices = await lastPrices(shown.map((m) => m.pairIndex));
  const byType = { holdings: 0, costs: 0, stocks: 0 };
  for (const t of types) byType[t.type === "costs" ? "costs" : t.type === "stocks" ? "stocks" : "holdings"] = num(t.usd);

  return {
    range,
    protectedUsd: num(totals.usd),
    protectedAtStart: num(totals.start_usd),
    openPlans: num(totals.open),
    activeHedges: num(totals.active),
    plansCreated: num(totals.created),
    plansCreatedInRange: num(totals.created_in_range),
    byStatus,
    byMarket: shown.map((m) => ({
      symbol: m.symbol,
      label: m.label,
      type: m.type,
      usd: num(byPair.get(m.pairIndex)?.usd),
      plans: num(byPair.get(m.pairIndex)?.n),
      price: prices.get(m.pairIndex) ?? null,
    })),
    byType,
    protectedSeries: protectedRows.map((r) => ({ t: new Date(r.day).toISOString(), v: num(r.usd) })),
    createdSeries: createdRows.map((r) => ({ t: new Date(r.t).toISOString(), v: num(r.n) })),
    createdBucket: bucket,
    liveProofs: num(live.n),
    builderCodeTxs: num(txs.n),
    proofs: proofs.map((p) => ({
      uid: String(p.uid),
      market: baseMarket(Number(p.pair_index))?.symbol ?? "—",
      protectedUsd: num((p.sizing as { notionalUsd?: number }).notionalUsd),
      at: new Date(p.created_at).toISOString(),
    })),
    activity: activity.map((a) => ({
      message: publicMessage(String(a.message)),
      market: baseMarket(Number(a.pair_index))?.symbol ?? "—",
      type: String(a.type),
      level: String(a.level),
      at: new Date(a.created_at).toISOString(),
    })),
    chain,
    keeperAgeS: beat ? num(beat.age) : null,
    at: new Date().toISOString(),
  };
}

/** The dashboard's figures, computed at most once a minute per server and range. */
const TTL_MS = 60_000;
const cached = new Map<RangeDays, { at: number; value: Promise<Metrics> }>();

/** Last prices for display, read together; a market that doesn't answer within 4 s shows none. */
async function lastPrices(pairs: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const timeout = new Promise<void>((r) => setTimeout(r, 4_000));
  await Promise.race([
    Promise.all(
      pairs.map((p) =>
        getSignedPrice(p, { forDisplay: true })
          .then((x) => x && out.set(p, x.price))
          .catch(() => undefined),
      ),
    ),
    timeout,
  ]);
  return new Map(out);
}

export function cachedMetrics(range: RangeDays): Promise<Metrics> {
  const hit = cached.get(range);
  if (hit && Date.now() - hit.at <= TTL_MS) return hit.value;
  const value = readMetrics(range);
  cached.set(range, { at: Date.now(), value });
  value.catch(() => cached.delete(range));
  return value;
}
