import type { Metadata } from "next";
import Link from "next/link";
import { BaseMark } from "@/components/base/BaseMark";
import { TimeChart, type TimePoint } from "@/components/metrics/TimeChart";
import { Card, Display, Eyebrow, Notice } from "@/components/ui";
import { proofPath } from "@/lib/base/attest";
import { cachedMetrics, RANGES, type Metrics, type RangeDays } from "@/lib/server/metrics";
import { usd } from "@/lib/ui/format";

// Rendered per request (so a build never needs the database), from figures cached for a minute.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Metrics — Locke",
  description: "What Locke protects right now on Base: value protected, plans, deposits, proofs and the keeper, live.",
};

/** Chart colours for plan types, validated together on the light surface (cobalt, orange). */
const TYPE_COLOR = { holdings: "#2343ff", costs: "#eb6834", stocks: "#0c0c0d" } as const;
/** The keeper's gas floor (worker/base-keeper.ts MIN_GAS_ETH): below it, it reports itself unhealthy. */
const KEEPER_GAS_FLOOR_ETH = 0.0002;

const count = (n: number) => n.toLocaleString("en-US");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

function ago(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} days ago`;
}

function since(iso: string): string {
  return ago((Date.now() - new Date(iso).getTime()) / 1000);
}

function parseRange(v: string | string[] | undefined): RangeDays {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return (RANGES as readonly number[]).includes(n) ? (n as RangeDays) : 30;
}

export default async function MetricsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range);
  let m: Metrics;
  try {
    m = await cachedMetrics(range);
  } catch {
    return <Notice tone="danger">Locke&apos;s metrics are unavailable right now. Try again shortly.</Notice>;
  }
  const change = m.protectedUsd - m.protectedAtStart;

  return (
    <div className="flex flex-col gap-3">
      {/* Title and the one filter row: the range scopes every figure below. */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-3">
        <div>
          <Eyebrow className="mb-5 flex items-center gap-2 text-ink-2">
            <BaseMark size={12} /> Metrics · Base
          </Eyebrow>
          <Display lead="Locke in numbers." rest="Live from Base and Locke's records." />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <nav aria-label="Time range" className="flex gap-1 rounded-full bg-mist p-1">
            {RANGES.map((r) => (
              <Link
                key={r}
                href={`/metrics?range=${r}`}
                scroll={false}
                aria-current={r === range ? "page" : undefined}
                className={`num inline-flex h-9 items-center rounded-full px-4 text-[13px] transition-colors ${r === range ? "bg-ink text-paper" : "text-ink-2 hover:text-ink"}`}
              >
                {r} days
              </Link>
            ))}
          </nav>
          <span className="num text-[12px] text-ink-3">Updated {time(m.at)} UTC</span>
        </div>
      </div>

      {/* Headline figures */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Protected now"
          value={usd(m.protectedUsd, 0)}
          sub={change === 0 ? `No change in ${range} days` : `${change > 0 ? "+" : "−"}${usd(Math.abs(change), 0)} in ${range} days`}
          subTone={change > 0 ? "ok" : change < 0 ? "bad" : undefined}
          dark
        />
        <Tile label="Open plans" value={count(m.openPlans)} sub={`${count(m.activeHedges)} with a live hedge`} />
        <Tile
          label="USDC in vaults"
          value={m.chain ? usd(m.chain.depositsUsd, 0) : "—"}
          sub={m.chain ? "Read from the factory on Base" : "Base can't be read right now"}
        />
        <Tile label="Plans created" value={count(m.plansCreatedInRange)} sub={`In ${range} days · ${count(m.plansCreated)} all time`} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <ChartCard
          className="lg:col-span-8"
          title="Value protected"
          sub="Hedge value open at the end of each day, in US dollars"
          table={m.protectedSeries.map((p) => [day(p.t), usd(p.v, 0)])}
          columns={["Day", "Protected"]}
        >
          <TimeChart points={m.protectedSeries as TimePoint[]} kind="area" format="usd" label={`Value protected over the last ${range} days`} empty="No hedges open in this period yet" />
        </ChartCard>

        <Card className="flex flex-col gap-6 lg:col-span-4">
          <h2 className="display text-[18px]">Capacity</h2>
          <Meter used={m.chain?.depositsUsd ?? null} cap={m.chain?.capUsd ?? null} />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-5 border-t border-line pt-5">
            <Fact label="Locke fee" value={m.chain ? `${(m.chain.feeBps / 100).toFixed(2)}%` : "—"} sub="Of each hedge, paid to Locke's Safe" />
            <Fact label="Live proofs" value={count(m.liveProofs)} sub="Protected by Locke attestations" />
            <Fact label="Builder Code transactions" value={count(m.builderCodeTxs)} sub="Plan creations and keeper actions" />
            <Fact label="Plans closed" value={count(m.byStatus.closed ?? 0)} sub="All time" />
          </dl>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard
          title="Plans created"
          sub={`New plans per ${m.createdBucket}`}
          table={m.createdSeries.map((p) => [(m.createdBucket === "week" ? "Week of " : "") + day(p.t), count(p.v)])}
          columns={[m.createdBucket === "week" ? "Week" : "Day", "Plans"]}
        >
          <TimeChart points={m.createdSeries as TimePoint[]} kind="columns" format="count" week={m.createdBucket === "week"} label={`Plans created per ${m.createdBucket}`} empty="No plans created in this period yet" />
        </ChartCard>

        <ChartCard
          title="Protected by market"
          sub="Open hedges on Veranta, by the market they hedge on"
          table={m.byMarket.map((r) => [r.symbol, usd(r.usd, 0), count(r.plans)])}
          columns={["Market", "Protected", "Plans"]}
        >
          <MarketBars rows={m.byMarket} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="flex flex-col gap-5">
          <div>
            <h2 className="display text-[18px]">What&apos;s protected</h2>
            <p className="mt-1 text-[13px] text-ink-2">Open hedge value by plan type</p>
          </div>
          <TypeSplit holdings={m.byType.holdings} costs={m.byType.costs} stocks={m.byType.stocks} />
          <div className="border-t border-line pt-5">
            <h3 className="text-[13px] text-ink-2">Plans by stage</h3>
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ["funding", "Waiting for deposit"],
                  ["opening", "Opening"],
                  ["active", "Protected"],
                  ["closed", "Closed"],
                ] as const
              ).map(([k, l]) => (
                <li key={k} className="rounded-xl bg-canvas px-3 py-2.5">
                  <div className="num text-[20px] leading-none">{count(m.byStatus[k] ?? 0)}</div>
                  <div className="mt-1.5 text-[12px] text-ink-2">{l}</div>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <KeeperCard ageS={m.keeperAgeS} live={m.chain != null} ethBalance={m.chain?.keeperEth ?? null} address={m.chain?.keeper ?? null} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <h2 className="display text-[18px]">Recent activity</h2>
          {m.activity.length === 0 ? (
            <p className="mt-4 text-[14px] text-ink-2">Nothing yet. Each plan&apos;s steps show here as they happen.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {m.activity.map((a, i) => (
                <li key={i} className="flex items-baseline justify-between gap-4 py-2.5 text-[14px]">
                  <span className="flex min-w-0 items-baseline gap-2.5">
                    <span
                      className="inline-block h-2 w-2 shrink-0 translate-y-[-1px] rounded-full"
                      style={{ background: a.type === "costs" ? TYPE_COLOR.costs : a.type === "stocks" ? TYPE_COLOR.stocks : TYPE_COLOR.holdings }}
                      aria-hidden
                    />
                    <span className="truncate">{a.message}</span>
                    <span className="num shrink-0 text-[12px] text-ink-3">{a.market}</span>
                  </span>
                  <span className="num shrink-0 text-[12px] text-ink-3">{since(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card tone="mist" className="lg:col-span-5">
          <h2 className="display text-[18px]">Latest proofs</h2>
          {m.proofs.length === 0 ? (
            <p className="mt-4 text-[14px] text-ink-2">No live proofs yet. Each plan gets one on Base when its hedge opens.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {m.proofs.map((p) => (
                <li key={p.uid} className="flex items-baseline justify-between gap-4 py-2.5 text-[14px]">
                  <Link href={proofPath(p.uid)} className="underline-offset-4 hover:underline">
                    {usd(p.protectedUsd, 0)} on {p.market}
                  </Link>
                  <span className="num shrink-0 text-[12px] text-ink-3">{day(p.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="pt-3 text-[13px] leading-relaxed text-ink-3">
        &quot;Protected&quot; is the size of the hedges open, in US dollars. USDC in vaults, capacity and the fee are read from Locke&apos;s factory
        contract on Base; plans and activity from Locke&apos;s own records, with no business or wallet named. Every proof can be checked
        independently on the Ethereum Attestation Service. Figures refresh every minute.
      </p>
    </div>
  );
}

function Tile({ label, value, sub, subTone, dark = false }: { label: string; value: string; sub: string; subTone?: "ok" | "bad"; dark?: boolean }) {
  const subCls = subTone === "ok" ? (dark ? "text-lime" : "text-ok") : subTone === "bad" ? (dark ? "text-paper" : "text-danger-ink") : dark ? "text-paper/55" : "text-ink-2";
  return (
    <Card tone={dark ? "ink" : "paper"} className="flex min-h-[132px] flex-col">
      <div className={`text-[13px] ${dark ? "text-paper/60" : "text-ink-2"}`}>{label}</div>
      <div className="num mt-auto pt-6 text-[26px] font-medium leading-none tracking-tight sm:text-[32px]">{value}</div>
      <div className={`num mt-2 text-[12px] ${subCls}`}>{sub}</div>
    </Card>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-2">{label}</dt>
      <dd className="num mt-1 text-[18px] leading-none">{value}</dd>
      <dd className="mt-1.5 text-[11px] leading-snug text-ink-3">{sub}</dd>
    </div>
  );
}

/** A chart in a card, with its values one tap away as a table. */
function ChartCard({
  title,
  sub,
  table,
  columns,
  className = "",
  children,
}: {
  title: string;
  sub: string;
  table: string[][];
  columns: string[];
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={`flex flex-col gap-4 ${className}`}>
      <div>
        <h2 className="display text-[18px]">{title}</h2>
        <p className="mt-1 text-[13px] text-ink-2">{sub}</p>
      </div>
      {children}
      <details className="group text-[13px]">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-ink-2 hover:text-ink">
          <span className="group-open:hidden">View as table</span>
          <span className="hidden group-open:inline">Hide table</span>
        </summary>
        <div className="mt-3 max-h-64 overflow-auto rounded-xl ring-1 ring-line">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-mist text-[12px] text-ink-2">
              <tr>
                {columns.map((c, i) => (
                  <th key={c} className={`px-3 py-2 font-medium ${i ? "text-right" : ""}`}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="num">
              {table.map((row, r) => (
                <tr key={r} className="border-t border-line">
                  {row.map((cell, i) => (
                    <td key={i} className={`px-3 py-1.5 ${i ? "text-right" : ""}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}

/** USDC in vaults against the factory's total cap. The fill turns amber past 80%, red past 95%. */
function Meter({ used, cap }: { used: number | null; cap: number | null }) {
  const share = used != null && cap ? Math.min(1, used / cap) : null;
  const fill = share == null ? "bg-line" : share >= 0.95 ? "bg-danger" : share >= 0.8 ? "bg-watch" : "bg-cobalt";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="num text-[26px] leading-none">{share == null ? "—" : `${(share * 100).toFixed(share < 0.1 && share > 0 ? 1 : 0)}%`}</span>
        <span className="num text-[12px] text-ink-2">{used != null && cap ? `${usd(used, 0)} of ${usd(cap, 0)}` : "Not available"}</span>
      </div>
      <div
        className="mt-3 h-2.5 overflow-hidden rounded-full bg-[#dfe4ff]"
        role="meter"
        aria-label="Deposit capacity used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={share == null ? undefined : Math.round(share * 100)}
      >
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${share == null ? 0 : Math.max(share > 0 ? 1.5 : 0, share * 100)}%` }} />
      </div>
      <p className="mt-2 text-[12px] text-ink-3">Deposit capacity used, across every plan. Locke&apos;s Safe raises the cap as it grows.</p>
    </div>
  );
}

/** One measure across four markets: one colour, value at the bar's tip. */
function MarketBars({ rows }: { rows: Metrics["byMarket"] }) {
  const max = Math.max(0, ...rows.map((r) => r.usd));
  return (
    <ul className="flex flex-col gap-4 py-1">
      {rows.map((r) => {
        const w = max > 0 ? (r.usd / max) * 100 : 0;
        return (
          <li key={r.symbol} className="grid grid-cols-[92px_1fr] items-center gap-3 sm:grid-cols-[110px_1fr]">
            <div className="min-w-0">
              <div className="num text-[13px]">{r.symbol}</div>
              <div className="truncate text-[11px] text-ink-3">{r.plans === 1 ? "1 plan" : `${count(r.plans)} plans`}</div>
            </div>
            <div className="flex items-center gap-2.5" title={`${r.symbol}: ${usd(r.usd, 0)}`}>
              {w > 0 ? <span className="h-3 rounded-r-[4px] bg-cobalt" style={{ width: `calc(${w}% - 64px)`, minWidth: 4 }} /> : <span className="h-3 w-px bg-line" />}
              <span className="num shrink-0 text-[13px] text-ink">{usd(r.usd, 0)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Holdings against operating costs: one whole, split in two, with a legend and values. */
function TypeSplit({ holdings, costs, stocks }: { holdings: number; costs: number; stocks: number }) {
  const total = holdings + costs + stocks;
  const parts = [
    { key: "holdings" as const, label: "Holdings · ETH, BTC", v: holdings },
    { key: "costs" as const, label: "Operating costs · WTI, Brent", v: costs },
    { key: "stocks" as const, label: "Stocks · shares and indices", v: stocks },
  ];
  return (
    <div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-[4px] bg-mist" role="img" aria-label={`Holdings ${usd(holdings, 0)}, operating costs ${usd(costs, 0)}, stocks ${usd(stocks, 0)}`}>
        {total > 0 && parts.map((p) => (p.v > 0 ? <span key={p.key} className="h-full" style={{ width: `${(p.v / total) * 100}%`, background: TYPE_COLOR[p.key] }} /> : null))}
      </div>
      <ul className="mt-4 flex flex-col gap-2.5">
        {parts.map((p) => (
          <li key={p.key} className="flex items-baseline justify-between gap-3 text-[14px]">
            <span className="flex items-center gap-2.5">
              <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: TYPE_COLOR[p.key] }} aria-hidden />
              {p.label}
            </span>
            <span className="num">
              {usd(p.v, 0)}
              <span className="ml-2 text-[12px] text-ink-3">{total > 0 ? `${Math.round((p.v / total) * 100)}%` : "—"}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Whether the keeper is watching: its last check-in and its gas, with a status that says it in words. */
function KeeperCard({ ageS, live, ethBalance, address }: { ageS: number | null; live: boolean; ethBalance: number | null; address: string | null }) {
  const state: { label: string; note: string; cls: string; icon: "ok" | "warn" | "down" } =
    ageS == null
      ? { label: "Not running yet", note: "The keeper hasn't checked in.", cls: "text-ink-2", icon: "down" }
      : ageS <= 120
        ? { label: "Watching", note: "Margin is checked every 15 seconds.", cls: "text-ok", icon: "ok" }
        : ageS <= 300
          ? { label: "Delayed", note: "The keeper's last check-in is late.", cls: "text-ink", icon: "warn" }
          : { label: "Offline", note: "The keeper hasn't checked in for a while.", cls: "text-danger-ink", icon: "down" };
  const gasLow = ethBalance != null && ethBalance < KEEPER_GAS_FLOOR_ETH;
  return (
    <Card tone="ink" className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="display text-[18px]">Keeper</h2>
          <p className="mt-1 text-[13px] text-paper/55">Opens hedges and tops up margin, within each plan&apos;s limits</p>
        </div>
        <span className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-paper px-3 text-[13px] font-medium ${state.cls}`}>
          <StatusIcon kind={state.icon} />
          {state.label}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
        <div>
          <dt className="text-[12px] text-paper/55">Last check-in</dt>
          <dd className="num mt-1 text-[18px] leading-none">{ageS == null ? "—" : ago(ageS)}</dd>
          <dd className="mt-1.5 text-[11px] text-paper/55">{state.note}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-paper/55">Gas for transactions</dt>
          <dd className="num mt-1 text-[18px] leading-none">{ethBalance == null ? "—" : `${ethBalance.toFixed(5)} ETH`}</dd>
          <dd className={`mt-1.5 text-[11px] ${gasLow ? "text-watch" : "text-paper/55"}`}>{!live ? "Not live yet" : gasLow ? "Low: below the keeper's safe level" : "Enough for routine top-ups"}</dd>
        </div>
      </dl>
      <div className="mt-auto flex flex-col gap-3 border-t border-paper/10 pt-5 text-[13px]">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-paper/55">Keeper address</span>
          {address ? (
            <a href={`https://basescan.org/address/${address}`} target="_blank" rel="noreferrer" className="num underline-offset-4 hover:underline">
              {address.slice(0, 6)}…{address.slice(-4)} ↗
            </a>
          ) : (
            <span className="num">—</span>
          )}
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-paper/55">What it can do</span>
          <span className="text-right">Trade within each plan&apos;s limits. Never withdraw.</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-paper/55">Who can remove it</span>
          <span className="text-right">Each plan&apos;s owner, from their own wallet</span>
        </div>
      </div>
    </Card>
  );
}

function StatusIcon({ kind }: { kind: "ok" | "warn" | "down" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      {kind === "ok" && <path d="M4.2 7.2l1.9 1.9 3.7-3.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
      {kind === "warn" && <path d="M7 3.8v3.6M7 9.6v.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
      {kind === "down" && <path d="M4.8 4.8l4.4 4.4M9.2 4.8L4.8 9.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
    </svg>
  );
}
