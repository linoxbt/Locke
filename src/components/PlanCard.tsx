"use client";

import Link from "next/link";
import type { CostsInputs } from "@/lib/domain/types";
import type { PlanView } from "@/lib/server/planService";
import { local, signedUsd, usd } from "@/lib/ui/format";
import { Arrow, Card, Eyebrow, MarginBar, REVEAL, StateChip, SUBTLE, type Tone } from "./ui";

export function headlineText(p: PlanView): { value: string; caption: string } {
  if (p.type === "holdings") return { value: usd(p.headline, 0), caption: "Protected value" };
  const c = p.inputs as CostsInputs;
  return { value: local(p.headline, c.currency, 0), caption: "Effective fuel price per litre" };
}

/** Card colour: the plan type when healthy, the risk colour when it needs attention. */
export function toneFor(p: PlanView): Tone {
  if (p.status === "closed" || p.status === "failed") return "mist";
  if (p.status !== "active") return "paper";
  if (p.riskLevel === "watch") return "watch";
  if (p.riskLevel !== "ok") return "danger";
  return p.type === "holdings" ? "cobalt" : "lime";
}

/** Where a plan card leads: its next step while it isn't open yet, else its overview. */
export function planHref(p: Pick<PlanView, "id" | "status">): string {
  if (p.status === "draft") return `/plans/${p.id}/preview`;
  if (p.status === "funding" || p.status === "opening") return `/plans/${p.id}/fund`;
  return `/plans/${p.id}`;
}

export function PlanCard({ p }: { p: PlanView }) {
  const h = headlineText(p);
  const tone = toneFor(p);
  const dark = tone === "cobalt" || tone === "danger" || tone === "ink";
  return (
    <Link href={planHref(p)} className="group block">
      <Card tone={tone} className="flex min-h-[220px] flex-col transition-transform duration-300 group-hover:-translate-y-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow className={SUBTLE[tone]}>{p.type === "holdings" ? "Holdings" : "Operating costs"}</Eyebrow>
            <div className={`mt-2 text-[17px] font-medium ${REVEAL} group-hover:whitespace-normal group-hover:[overflow-wrap:anywhere]`} title={p.name}>
              {p.name}
            </div>
          </div>
          <StateChip status={p.status} level={p.riskLevel} />
        </div>
        <div className="mt-auto pt-8">
          <div className="num text-[32px] leading-none sm:text-[38px]">{h.value}</div>
          <div className={`mt-2 flex items-center justify-between text-[14px] ${SUBTLE[tone]}`}>
            <span>{h.caption}</span>
            <span className="num">{p.label}</span>
          </div>
        </div>
        {p.status === "active" ? (
          <div className="mt-6 space-y-4">
            <MarginBar ratio={p.ratio} watch={p.thresholds.watch} action={p.thresholds.action} onDark={dark} />
            <div className={`grid grid-cols-2 gap-4 text-[13px] ${SUBTLE[tone]}`}>
              <div>
                Funding to date
                <div className={`num mt-0.5 text-[15px] ${dark ? "text-paper" : "text-ink"}`}>{signedUsd(p.position?.fundingToDate ?? 0)}</div>
              </div>
              <div>
                Cost of protection
                <div className={`num mt-0.5 text-[15px] ${dark ? "text-paper" : "text-ink"}`}>{signedUsd(p.fundingPerDay)}/day</div>
              </div>
            </div>
          </div>
        ) : (
          <div className={`mt-6 flex items-center justify-between text-[14px] ${SUBTLE[tone]}`}>
            <span className="line-clamp-1">{p.statusNote ?? (p.status === "closed" ? "Plan closed" : "Waiting on Strike")}</span>
            <Arrow />
          </div>
        )}
      </Card>
    </Link>
  );
}
