"use client";

import Link from "next/link";
import { LineChart } from "../LineChart";
import { headlineText, toneFor } from "../PlanCard";
import { Arrow, Card, Eyebrow, LinkButton, MarginBar, Stat, SUBTLE } from "../ui";
import { DelegationPanel } from "./DelegationPanel";
import { usePlan } from "./PlanProvider";
import type { CostsInputs, HoldingsInputs } from "@/lib/domain/types";
import { ago, local, num, pct, price, signedUsd, usd } from "@/lib/ui/format";

export function PlanOverview() {
  const { detail: d } = usePlan();
  const p = d.plan;
  const base = `/plans/${p.id}`;
  const h = headlineText(p);
  const cur = p.type === "costs" ? (p.inputs as CostsInputs).currency : "USD";
  const urgent = p.status === "active" && p.riskLevel !== "ok" && p.riskLevel !== "watch";
  const tone = toneFor(p);
  const dark = tone === "cobalt" || tone === "danger";
  const fmtHeadline = (n: number) => (p.type === "holdings" ? usd(n, 0) : local(n, cur, 0));

  return (
    <div className="space-y-3">
      {urgent && (
        <Card tone="danger" className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="display text-[18px]">
              {p.riskLevel === "action" ? "Action needed." : p.riskLevel === "margin_call" ? "Margin call on Strike." : "This plan is at risk."}
            </div>
            <p className="mt-1 text-[14px] text-paper/80">
              Liquidation is {pct(p.liquidationDistance, 1)} away (margin ratio {pct(p.ratio, 1)}). Top up {usd(p.suggestedTopUpUsd)} to move it back
              to a safe distance.
            </p>
          </div>
          <LinkButton href={`${base}/top-up`} variant="paper" size="lg" className="shrink-0">
            Top up now <Arrow />
          </LinkButton>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Card tone={tone} className="flex flex-col lg:col-span-8 lg:min-h-[218px]">
          <Eyebrow className={SUBTLE[tone]}>{h.caption}</Eyebrow>
          <div className="num mt-6 text-[28px] leading-none tracking-tight sm:text-[40px]">{h.value}</div>
          {p.status === "active" && (
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
              <Stat label="Hedge size" value={`${num(p.position?.size ?? p.sizing.size, 2)} ${p.symbol.split("-")[0]}`} sub={usd((p.position?.size ?? 0) * p.mark, 0)} />
              <Stat label="Hedge result" value={signedUsd(p.position?.upnl ?? 0)} sub="offsets the exposure" />
              <Stat label="Funding to date" value={signedUsd(p.position?.fundingToDate ?? 0)} tone={(p.position?.fundingToDate ?? 0) >= 0 ? "ok" : "bad"} />
              <Stat label="Cost of protection" value={signedUsd(p.fundingPerDay)} sub={`per day, ${p.fundingPerDay >= 0 ? "received" : "paid"}`} />
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
                  <span className="num mt-0.5 block text-[12px] text-ink-3">{ago(e.created_at)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
