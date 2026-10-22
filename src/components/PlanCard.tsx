"use client";

import Link from "next/link";
import type { PlanView } from "@/lib/server/planService";
import { local, signedUsd, usd } from "@/lib/ui/format";
import { MarginBar, StateChip } from "./ui";
import type { CostsInputs } from "@/lib/domain/types";

export function headlineText(p: PlanView): { value: string; caption: string } {
  if (p.type === "holdings") return { value: usd(p.headline, 0), caption: "Protected value" };
  const c = p.inputs as CostsInputs;
  return { value: local(p.headline, c.currency, 0), caption: "Effective fuel price / litre" };
}

export function toneFor(p: PlanView): string {
  if (p.status !== "active") return p.status === "closed" ? "" : "accent";
  if (p.riskLevel === "watch") return "watch";
  if (p.riskLevel !== "ok") return "danger";
  return "accent";
}

export function PlanCard({ p }: { p: PlanView }) {
  const h = headlineText(p);
  return (
    <Link href={`/plans/${p.id}`} className={`bracket ${toneFor(p)} block p-5 transition hover:brightness-110`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="num text-[11px] uppercase tracking-wider text-muted">{p.type === "holdings" ? "Holdings" : "Operating costs"}</div>
          <div className="mt-0.5 font-medium">{p.name}</div>
        </div>
        <StateChip status={p.status} level={p.riskLevel} />
      </div>
      <div className="mt-4">
        <div className="num text-3xl font-semibold">{h.value}</div>
        <div className="text-xs text-muted">{h.caption}</div>
      </div>
      <div className="num mt-1 text-[11px] text-accent">{p.label}</div>
      {p.status === "active" && (
        <div className="mt-4 space-y-3">
          <MarginBar ratio={p.ratio} watch={p.thresholds.watch} action={p.thresholds.action} />
          <div className="flex justify-between text-xs">
            <span className="text-muted">Funding to date</span>
            <span className="num">{signedUsd(p.position?.fundingToDate ?? 0)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted">Cost of protection</span>
            <span className="num">{signedUsd(p.fundingPerDay)} / day</span>
          </div>
        </div>
      )}
      {p.statusNote && p.status !== "active" && <p className="mt-3 text-xs text-faint">{p.statusNote}</p>}
    </Link>
  );
}
