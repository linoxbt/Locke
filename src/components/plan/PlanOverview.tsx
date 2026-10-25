"use client";

import Link from "next/link";
import { LineChart } from "../LineChart";
import { headlineText, pendingText, toneFor } from "../PlanCard";
import { Arrow, Card, Eyebrow, LinkButton, MarginBar, Stat, SUBTLE } from "../ui";
import { DelegationPanel } from "./DelegationPanel";
import { usePlan } from "./PlanProvider";
import type { CostsInputs, HoldingsInputs } from "@/lib/domain/types";
import { localPrice, num, pct, price, signedUsd, usd } from "@/lib/ui/format";
import { Ago } from "../Time";
import { LiveValue } from "../LiveValue";
import { nextFundingUsd, withMark } from "@/lib/domain/live";

/** Small amounts need more places to show second-by-second moves. */
const places = (n: number) => (Math.abs(n) < 100 ? 4 : 2);
const fineSigned = (n: number) => signedUsd(n, places(n));
const fineUsd = (n: number) => usd(n, places(n));

function countdown(ms: number): string {
  if (!(ms > 0)) return "now";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function PlanOverview() {
  const { detail: d, tick } = usePlan();
  // Between server reads, everything that follows the mark moves with Strike's price stream.
  const p = withMark(d.plan, tick);
  const live = !!tick && p.status === "active" && !!p.position && !p.liveUnavailable;
  const base = `/plans/${p.id}`;
  const h = headlineText(p);
  const cur = p.type === "costs" ? (p.inputs as CostsInputs).currency : "USD";
  const urgent = p.status === "active" && p.riskLevel !== "ok" && p.riskLevel !== "watch";
  const pending = pendingText(p);
  const tone = toneFor(p);
  const dark = tone === "cobalt" || tone === "danger";
  const fmtHeadline = (n: number) => (p.type === "holdings" ? usd(n, 0) : localPrice(n, cur));

  return (
    <div className="space-y-3">
      {urgent && (
        <Card tone="danger" className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="display text-[18px]">
              {p.riskLevel === "action" ? "Action needed." : p.riskLevel === "margin_call" ? "Margin call on Strike." : "This plan is at risk."}
            </div>
            <p className="mt-1 text-[14px] text-paper">
              Liquidation is {pct(p.liquidationDistance, 1)} away and margin health is low. Top up {usd(p.suggestedTopUpUsd)} to move it back to a
              safe distance.
            </p>
          </div>
          <LinkButton href={`${base}/top-up`} variant="paper" size="lg" className="shrink-0">
            Top up now <Arrow />
          </LinkButton>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Card tone={tone} className="flex flex-col lg:col-span-8 lg:min-h-[218px]">
          <div className="flex items-center justify-between gap-3">
            <Eyebrow className={SUBTLE[tone]}>{h.caption}</Eyebrow>
            {live && (
              <span className={`num inline-flex items-center gap-1.5 text-[12px] ${SUBTLE[tone]}`} title="Strike mark price, updated every second">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden /> Live
              </span>
            )}
          </div>
          <div className="num mt-6 text-[28px] leading-none tracking-tight sm:text-[40px]">
            {live && p.type === "holdings" ? <LiveValue value={p.headline} format={(n) => usd(n, 2)} /> : h.value}
          </div>
          {live && p.type === "holdings" && p.position && (
            <p className={`num mt-3 text-[13px] ${SUBTLE[tone]}`}>
              {num(p.position.size, 2)} ADA <LiveValue value={p.position.size * p.mark} format={fineUsd} /> · hedge{" "}
              <LiveValue value={p.position.upnl} format={fineSigned} /> · funding <LiveValue value={p.position.fundingToDate} format={fineSigned} />
            </p>
          )}
          {pending && <p className={`mt-4 text-[14px] ${SUBTLE[tone]}`}>{pending}</p>}
          {p.status === "active" && p.liveUnavailable && (
            <p className={`mt-auto pt-8 text-[14px] ${SUBTLE[tone]}`}>
              Live numbers unavailable: Strike can&apos;t be reached right now. Figures below are the last known; Locke keeps watching.
            </p>
          )}
          {p.status === "active" && !p.liveUnavailable && (
            <div className="mt-auto pt-8">
              <div className={`mb-3 flex justify-between text-[13px] ${SUBTLE[tone]}`}>
                <span>Margin health</span>
                <span>{p.riskLevel === "ok" ? "Healthy" : p.riskLevel.replace("_", " ")}</span>
              </div>
              <MarginBar ratio={p.ratio} watch={p.thresholds.watch} action={p.thresholds.action} onDark={dark} />
            </div>
          )}
          {p.status === "closing" && <p className={`mt-auto pt-8 text-[14px] ${SUBTLE[tone]}`}>Closing on Strike…</p>}
          {p.status === "closed" && <p className={`mt-auto pt-8 text-[14px] ${SUBTLE[tone]}`}>This plan is closed. Its margin is back on your Strike balance.</p>}
        </Card>

        <div className="grid grid-cols-1 gap-3 lg:col-span-4">
          <Card>
            <div className="grid grid-cols-2 gap-x-4 gap-y-6">
              <Stat
                label="Hedge size"
                value={`${num(p.position?.size ?? p.sizing.size, 2)} ${p.symbol.split("-")[0]}`}
                sub={<LiveValue value={(p.position?.size ?? 0) * p.mark} format={fineUsd} />}
              />
              <Stat
                label="Hedge result"
                value={<LiveValue value={p.position?.upnl ?? 0} format={fineSigned} />}
                tone={(p.position?.upnl ?? 0) >= 0 ? "ok" : "bad"}
                sub="offsets the exposure"
              />
              <Stat
                label="Funding to date"
                value={<LiveValue value={p.position?.fundingToDate ?? 0} format={fineSigned} />}
                tone={(p.position?.fundingToDate ?? 0) >= 0 ? "ok" : "bad"}
                sub={
                  live && tick?.nextFundingTime ? (
                    <>
                      next <LiveValue value={nextFundingUsd(p)} format={fineSigned} /> in {countdown(tick.nextFundingTime - tick.at)}
                    </>
                  ) : undefined
                }
              />
              <Stat
                label="Cost of protection"
                value={<LiveValue value={p.fundingPerDay} format={fineSigned} />}
                tone={p.fundingPerDay >= 0 ? "ok" : "bad"}
                sub={`per day, ${p.fundingPerDay >= 0 ? "received" : "paid"}`}
              />
              <Stat label="Top-up asked at" value={price(p.alertPrice)} sub={<>mark <LiveValue value={p.mark} format={price} /></>} />
              <Stat
                label="Liquidation"
                value={p.position && p.position.liquidationPrice == null ? "None" : price(p.position?.liquidationPrice)}
                sub={p.liquidationDistance != null ? <><LiveValue value={p.liquidationDistance} format={(n) => pct(n, 2)} /> away</> : undefined}
                tone="bad"
              />
            </div>
          </Card>
          {p.status === "active" && (
            <div className="grid grid-cols-3 gap-2">
              <LinkButton href={`${base}/top-up`} variant="ink">
                Top up
              </LinkButton>
              <LinkButton href={`${base}/resize`} variant="ghost">
                Resize
              </LinkButton>
              <LinkButton href={`${base}/close`} variant="danger">
                Close
              </LinkButton>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <div className="flex items-baseline justify-between">
            <h2 className="display text-[17px]">{h.caption}</h2>
            <span className="text-[13px] text-ink-3">last 7 days</span>
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
          {p.type === "holdings" && <DelegationPanel q={((p.inputs as HoldingsInputs).amountHeld * (p.inputs as HoldingsInputs).sharePct) / 100} />}
          <Card>
            <div className="flex items-baseline justify-between">
              <h2 className="display text-[17px]">Latest</h2>
              <Link href={`${base}/activity`} className="text-[13px] text-cobalt">
                All activity
              </Link>
            </div>
            <ol className="mt-5 space-y-4">
              {d.events.length === 0 && <li className="text-[13px] text-ink-3">No events yet.</li>}
              {d.events.slice(0, 4).map((e) => (
                <li key={e.id} className="text-[13px] leading-snug">
                  {e.message}
                  <span className="num mt-0.5 block text-[12px] text-ink-3"><Ago iso={e.created_at} /></span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
