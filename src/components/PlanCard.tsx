import Link from "next/link";
import { baseMarket } from "@/lib/base/contracts";
import type { RiskLevel } from "@/lib/domain/types";
import { usd } from "@/lib/ui/format";
import { Arrow, Card, Eyebrow, REVEAL, StateChip, SUBTLE, type Tone } from "./ui";

/** A plan as the portfolio lists it: one row of base_vaults. */
export interface PlanRow {
  address: string;
  pair_index: number;
  type: string;
  name: string;
  status: string;
  risk_level: string | null;
  last_ratio: number | string | null;
  sizing: { notionalUsd?: number; depositUsd?: number } | null;
}

/** Card colour: the plan type when healthy, the risk colour when it needs attention. */
export function toneFor(p: PlanRow): Tone {
  if (p.status === "closed" || p.status === "failed") return "mist";
  if (p.status !== "active") return "paper";
  const level = (p.risk_level ?? "ok") as RiskLevel;
  if (level === "watch") return "watch";
  if (level !== "ok") return "danger";
  return p.type === "holdings" ? "cobalt" : p.type === "stocks" ? "ink" : "lime";
}

const WAITING: Record<string, string> = {
  funding: "Waiting for the deposit",
  opening: "Opening the hedge on Veranta…",
  closing: "Closing the hedge on Veranta…",
  closed: "Plan closed",
  failed: "Needs attention",
};

export function PlanCard({ p }: { p: PlanRow }) {
  const tone = toneFor(p);
  const level = (p.risk_level ?? "ok") as RiskLevel;
  const ratio = p.last_ratio == null ? null : Number(p.last_ratio);
  const market = baseMarket(Number(p.pair_index));
  return (
    <Link href={`/plans/${p.address}`} className="group block">
      <Card tone={tone} className="flex min-h-[172px] flex-col transition-transform duration-300 group-hover:-translate-y-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow className={SUBTLE[tone]}>{p.type === "holdings" ? "Holdings" : p.type === "stocks" ? "Stocks" : "Operating costs"}</Eyebrow>
            <div className={`mt-2 text-[15px] font-medium ${REVEAL}`} title={p.name}>
              {p.name}
            </div>
          </div>
          <StateChip status={p.status} level={p.status === "active" && level !== "ok" ? level : undefined} />
        </div>
        <div className="mt-auto pt-8">
          <div className="num text-[24px] leading-none sm:text-[28px]">{usd(p.sizing?.notionalUsd, 0)}</div>
          <div className={`mt-2 flex items-center justify-between text-[13px] ${SUBTLE[tone]}`}>
            <span>
              {p.status === "active"
                ? p.type !== "costs"
                  ? "Protected value"
                  : "Fuel spend hedged"
                : p.status === "closed"
                  ? "Was protected"
                  : "To protect once the hedge opens"}
            </span>
            <span className="num">{market?.symbol}</span>
          </div>
        </div>
        <div className={`mt-6 flex items-center justify-between text-[13px] ${SUBTLE[tone]}`}>
          <span className="line-clamp-1">
            {p.status === "active" ? (ratio == null ? "Protected" : `Margin use ${Math.round(ratio * 100)}%`) : (WAITING[p.status] ?? "Waiting on Veranta")}
          </span>
          <Arrow />
        </div>
      </Card>
    </Link>
  );
}
