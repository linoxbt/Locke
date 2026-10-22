"use client";

import { LineChart } from "../LineChart";
import { Card } from "../ui";
import { usePlan } from "./PlanProvider";
import { ago, pct } from "@/lib/ui/format";

const DOT: Record<string, string> = { info: "bg-cobalt", ok: "bg-ok", watch: "bg-watch" };

export function ActivityView() {
  const { detail: d } = usePlan();
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Card className="lg:col-span-7">
        <h2 className="display text-[24px]">Everything that happened</h2>
        <ol className="mt-6 divide-y divide-line">
          {d.events.length === 0 && <li className="py-4 text-[14px] text-ink-3">No events yet.</li>}
          {d.events.map((e) => (
            <li key={e.id} className="flex gap-4 py-4">
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[e.level] ?? "bg-danger"}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] leading-snug">{e.message}</p>
                <p className="num mt-1 text-[12px] text-ink-3">
                  {new Date(e.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · {ago(e.created_at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
      <Card className="lg:col-span-5">
        <h2 className="display text-[24px]">Margin ratio</h2>
        <p className="mt-1 text-[13px] text-ink-3">Recorded every minute by the risk worker. Strike&apos;s margin call is at 70%.</p>
        <div className="mt-6">
          <LineChart
            height={220}
            format={(n) => pct(n, 2)}
            series={[{ label: "Margin ratio", color: "var(--color-danger)", values: d.snapshots.map((s) => Number(s.ratio ?? NaN)) }]}
          />
        </div>
      </Card>
    </div>
  );
}
