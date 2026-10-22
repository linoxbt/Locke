"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LineChart } from "@/components/LineChart";
import { headlineText, toneFor } from "@/components/PlanCard";
import { DelegationPanel } from "@/components/plan/DelegationPanel";
import { PendingPlan } from "@/components/plan/PendingPlan";
import { CloseSheet, ResizeSheet, TopUpSheet } from "@/components/plan/Sheets";
import type { PlanDetail } from "@/components/plan/types";
import { ReplayPanel } from "@/components/ReplayPanel";
import { Arrow, Button, Card, Display, ErrorNote, Eyebrow, MarginBar, Notice, Spinner, Stat, StateChip, SUBTLE } from "@/components/ui";
import { useWallet } from "@/components/WalletProvider";
import type { CostsInputs, HoldingsInputs } from "@/lib/domain/types";
import { api, errorMessage } from "@/lib/ui/api";
import { ago, CARDANOSCAN, local, num, pct, price, shortAddr, signedUsd, usd } from "@/lib/ui/format";

const WAITING = new Set(["funding", "opening", "closing"]);

export default function PlanPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { me, loading, refreshMe } = useWallet();
  const [d, setD] = useState<PlanDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | "topup" | "resize" | "close">(null);
  const [adaPrice, setAdaPrice] = useState<number | null>(null);
  const replayRef = useRef<HTMLDivElement>(null);
  const latest = useRef<PlanDetail | null>(null);
  latest.current = d;

  const load = useCallback(async () => {
    try {
      const cur = latest.current;
      // While a plan waits on Strike, nudge it forward; the worker does the same in the background.
      const pending = cur && (WAITING.has(cur.plan.status) || cur.deposits.some((x) => x.status === "submitted" || x.status === "credited"));
      if (pending) await api(`/api/plans/${id}/sync`, { body: {} }).catch(() => {});
      setD(await api<PlanDetail>(`/api/plans/${id}`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    if (!loading && !me) router.replace("/");
  }, [loading, me, router]);

  useEffect(() => {
    if (!me) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await load();
      if (stop) return;
      const waiting = latest.current && WAITING.has(latest.current.plan.status);
      timer = setTimeout(loop, waiting ? 5000 : 10_000);
    };
    void loop();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [me, load]);

  useEffect(() => {
    api<{ ada: { mark: number } }>("/api/market").then((m) => setAdaPrice(m.ada.mark)).catch(() => {});
  }, []);

  if (!me) return null;
  if (!d) {
    return (
      <div className="mt-24 flex flex-col items-center gap-6">
        {error ? <ErrorNote error={error} /> : <Spinner />}
        <Link href="/portfolio" className="text-[14px] text-ink-2 underline underline-offset-4">
          Back to portfolio
        </Link>
      </div>
    );
  }

  const p = d.plan;
  const h = headlineText(p);
  const cur = p.type === "costs" ? (p.inputs as CostsInputs).currency : "USD";
  const urgent = p.status === "active" && p.riskLevel !== "ok" && p.riskLevel !== "watch";
  const tone = toneFor(p);
  const dark = tone === "cobalt" || tone === "danger";
  const live = p.status === "active" || p.status === "closing" || p.status === "closed";
  const fmtHeadline = (n: number) => (p.type === "holdings" ? usd(n, 0) : local(n, cur, 0));

  return (
    <div className="animate-rise">
      <Link href="/portfolio" className="mb-6 inline-flex h-10 items-center gap-2 rounded-full bg-paper px-4 text-[14px] text-ink-2 hover:text-ink">
        <Arrow className="rotate-180" /> Portfolio
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow className="text-ink-2">
            {p.type === "holdings" ? "Holdings plan" : "Operating costs plan"} · {p.label}
          </Eyebrow>
          <Display size="lg" lead={p.name} className="mt-3 max-w-[20ch]" />
        </div>
        <StateChip status={p.status} level={p.riskLevel} />
      </div>

      <div className="mt-6 space-y-2">
        {d.liveError && <Notice>Live numbers from Strike are unavailable right now ({d.liveError}). Retrying.</Notice>}
        {p.demoAlerts && p.status === "active" && (
          <Notice>Demo setting on: alert levels are lowered so the alert and top-up flow shows without a real price move.</Notice>
        )}
      </div>

      {(p.status === "draft" || p.status === "funding" || p.status === "opening") && <PendingPlan d={d} adaPrice={adaPrice} onChange={load} />}

      {live && (
        <>
          {urgent && (
            <Card tone="danger" className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="display text-[28px]">
                  {p.riskLevel === "action" ? "Action needed." : p.riskLevel === "margin_call" ? "Margin call on Strike." : "This plan is at risk."}
                </div>
                <p className="mt-1 text-[15px] text-paper/80">
                  Liquidation is {pct(p.liquidationDistance, 1)} away (margin ratio {pct(p.ratio, 1)}). Top up {usd(p.suggestedTopUpUsd)} to move it back to a
                  safe distance.
                </p>
              </div>
              <Button variant="paper" size="lg" onClick={() => setSheet("topup")} className="shrink-0">
                Top up now <Arrow />
              </Button>
            </Card>
          )}

          <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-12">
            <Card tone={tone} className="flex flex-col lg:col-span-8 lg:min-h-[460px]">
              <Eyebrow className={SUBTLE[tone]}>{h.caption}</Eyebrow>
              <div className="num mt-6 text-[56px] leading-none tracking-tight sm:text-[96px]">{h.value}</div>
              {p.status === "active" && (
                <div className="mt-auto pt-12">
                  <div className={`mb-3 flex justify-between text-[14px] ${SUBTLE[tone]}`}>
                    <span>Margin health</span>
                    <span>{p.riskLevel === "ok" ? "Healthy" : p.riskLevel.replace("_", " ")}</span>
                  </div>
                  <MarginBar ratio={p.ratio} watch={p.thresholds.watch} action={p.thresholds.action} onDark={dark} />
                </div>
              )}
              {p.status === "closing" && <p className={`mt-auto pt-12 text-[15px] ${SUBTLE[tone]}`}>Closing on Strike…</p>}
            </Card>

            <div className="grid grid-cols-1 gap-3 lg:col-span-4">
              <Card>
                <div className="grid grid-cols-2 gap-x-4 gap-y-6">
                  <Stat label="Hedge size" value={`${num(p.position?.size ?? p.sizing.size, 2)} ${p.symbol.split("-")[0]}`} sub={usd((p.position?.size ?? 0) * p.mark, 0)} />
                  <Stat label="Hedge result" value={signedUsd(p.position?.upnl ?? 0)} sub="offsets the exposure" />
                  <Stat label="Funding to date" value={signedUsd(p.position?.fundingToDate ?? 0)} tone={(p.position?.fundingToDate ?? 0) >= 0 ? "ok" : "bad"} />
                  <Stat label="Cost of protection" value={`${signedUsd(p.fundingPerDay)}`} sub={`per day, ${p.fundingPerDay >= 0 ? "received" : "paid"}`} />
                  <Stat label="Top-up asked at" value={price(p.alertPrice)} sub={`mark ${price(p.mark)}`} />
                  <Stat
                    label="Liquidation"
                    value={p.position && p.position.liquidationPrice == null ? "None" : price(p.position?.liquidationPrice)}
                    sub={p.liquidationDistance != null ? `${pct(p.liquidationDistance, 1)} away` : undefined}
                    tone="bad"
                  />
                </div>
              </Card>
              {p.status === "active" && (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="ink" onClick={() => setSheet("topup")}>
                    Top up
                  </Button>
                  <Button variant="ghost" onClick={() => setSheet("resize")}>
                    Resize
                  </Button>
                  <Button variant="ghost" onClick={() => replayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                    Replay
                  </Button>
                  <Button variant="danger" onClick={() => setSheet("close")}>
                    Close
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-12">
            <Card className="lg:col-span-8">
              <div className="flex items-baseline justify-between">
                <h2 className="display text-[24px]">{h.caption}</h2>
                <span className="text-[13px] text-ink-3">since opening</span>
              </div>
              <div className="mt-6">
                <LineChart
                  height={200}
                  format={fmtHeadline}
                  series={[
                    {
                      label: h.caption,
                      color: p.type === "holdings" ? "var(--color-cobalt)" : "var(--color-ink)",
                      area: true,
                      values: d.snapshots.map((s) => Number(s.headline ?? NaN)),
                    },
                  ]}
                />
              </div>
            </Card>
            <div className="grid grid-cols-1 gap-3 lg:col-span-4">
              {p.type === "holdings" && <DelegationPanel q={(p.inputs as HoldingsInputs).amountHeld} />}
              <Card>
                <h2 className="display text-[24px]">Activity</h2>
                <ol className="mt-5 max-h-80 space-y-4 overflow-y-auto pr-1">
                  {d.events.length === 0 && <li className="text-[14px] text-ink-3">No events yet.</li>}
                  {d.events.map((e) => (
                    <li key={e.id} className="flex gap-3 text-[14px]">
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          e.level === "info" || e.level === "ok" ? "bg-cobalt" : e.level === "watch" ? "bg-watch" : "bg-danger"
                        }`}
                        aria-hidden
                      />
                      <span className="flex-1 leading-snug">
                        {e.message}
                        <span className="num mt-0.5 block text-[12px] text-ink-3">{ago(e.created_at)}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </Card>
            </div>
          </div>

          <div ref={replayRef} className="mt-3 scroll-mt-24">
            <Card tone="ink" className="sm:p-10">
              <ReplayPanel planId={p.id} type={p.type} currency={cur} litres={p.type === "costs" ? (p.inputs as CostsInputs).litresPerMonth : 1} />
            </Card>
          </div>

          {p.position && (
            <details className="group mt-3 rounded-[var(--radius-card)] bg-paper p-5 sm:p-7 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer items-center justify-between">
                <span className="display text-[24px]">Strike details</span>
                <span className="text-[22px] text-ink-3 transition group-open:rotate-45">+</span>
              </summary>
              <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  ["Market", p.symbol],
                  ["Side", p.side === "sell" ? "Short" : "Long"],
                  ["Size", num(p.position.size, 4)],
                  ["Entry", price(p.position.entry)],
                  ["Mark", price(p.mark)],
                  ["Leverage", `${p.position.leverage}x`],
                  ["Isolated balance", usd(p.position.isoBalance)],
                  ["Maintenance margin", usd(p.position.maintenanceMargin)],
                  ["Margin ratio", pct(p.ratio, 2)],
                  ["Liquidation", price(p.position.liquidationPrice)],
                  ["Funding rate", `${pct(p.hourlyFundingRate, 4)}/h`],
                  ["Builder fee", `${p.builderFeeBps} bps`],
                ].map(([k, v]) => (
                  <Stat key={k} label={k} value={v} />
                ))}
              </div>
              {d.deposits.length > 0 && (
                <div className="mt-8 border-t border-line pt-5">
                  <h3 className="text-[14px] text-ink-2">Deposits</h3>
                  <ul className="mt-3 space-y-2">
                    {d.deposits.map((x) => (
                      <li key={x.id} className="num flex flex-wrap justify-between gap-2 text-[13px]">
                        <span>
                          {x.purpose} · {num(Number(x.lovelace) / 1e6, 2)} ADA · {x.status}
                        </span>
                        {x.tx_hash && (
                          <a className="text-cobalt" href={`${CARDANOSCAN}${x.tx_hash}`} target="_blank" rel="noreferrer">
                            {shortAddr(x.tx_hash)} ↗
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </details>
          )}
        </>
      )}

      <TopUpSheet open={sheet === "topup"} onClose={() => setSheet(null)} plan={p} adaPrice={adaPrice} onDone={load} />
      <ResizeSheet open={sheet === "resize"} onClose={() => setSheet(null)} plan={p} onDone={load} />
      <CloseSheet
        open={sheet === "close"}
        onClose={() => setSheet(null)}
        plan={p}
        onDone={async () => {
          await load();
          void refreshMe();
        }}
      />
    </div>
  );
}
