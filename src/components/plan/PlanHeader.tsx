"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Arrow, Display, ErrorNote, Eyebrow, Notice, StateChip } from "../ui";
import { usePlan } from "./PlanProvider";

const PENDING = new Set(["draft", "funding", "opening"]);

export function PlanHeader() {
  const { detail, error } = usePlan();
  const p = detail.plan;
  const path = usePathname();
  const base = `/plans/${p.id}`;
  const tabs = PENDING.has(p.status)
    ? [
        { href: `${base}/preview`, label: "Preview" },
        { href: `${base}/fund`, label: "Fund" },
        { href: `${base}/replay`, label: "Replay" },
      ]
    : [
        { href: base, label: "Overview" },
        { href: `${base}/replay`, label: "Replay" },
        { href: `${base}/activity`, label: "Activity" },
        { href: `${base}/strike`, label: "Strike details" },
      ];

  return (
    <div className="mb-8">
      <Link href="/portfolio" className="mb-6 inline-flex h-10 items-center gap-2 rounded-full bg-paper px-4 text-[14px] text-ink-2 hover:text-ink">
        <Arrow className="rotate-180" /> Portfolio
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow className="text-ink-2">
            {p.type === "holdings" ? "Holdings plan" : "Operating costs plan"} · {p.label}
          </Eyebrow>
          <Display size="lg" lead={p.name} className="mt-3 max-w-[20ch]" />
        </div>
        <StateChip status={p.status} level={p.riskLevel} />
      </div>
      <nav aria-label="Plan" className="-mx-1 mt-8 flex gap-1 overflow-x-auto px-1 pb-1">
        {tabs.map((t) => {
          // Top-up, resize and close are pages of their own that belong under Overview.
          const on = path === t.href || (t.href === base && /\/(top-up|resize|close)$/.test(path));
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={`inline-flex h-10 shrink-0 items-center rounded-full px-4 text-[14px] transition ${on ? "bg-ink text-paper" : "bg-paper text-ink-2 hover:text-ink"}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-4 space-y-2">
        <ErrorNote error={error} />
        {detail.liveError && <Notice>Live numbers from Strike are unavailable right now ({detail.liveError}). Retrying.</Notice>}
        {p.demoAlerts && p.status === "active" && <Notice>Demo setting on: alert levels are lowered so the alert and top-up flow shows without a real price move.</Notice>}
      </div>
    </div>
  );
}
