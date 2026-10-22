"use client";

import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/ui/api";
import { local, pct, usd } from "@/lib/ui/format";
import { LineChart } from "./LineChart";
import { ErrorNote, Spinner } from "./ui";

interface ReplayData {
  days: number;
  availableDays: number;
  shortened: boolean;
  hourlyFundingRate: number;
  points: { t: number; price: number; without: number; with: number; funding: number }[];
}

/** Without Locke vs with Locke against real Strike mark history, animated over ~10 s with a scrubber. */
export function ReplayPanel({ planId, type, currency, litres }: { planId: string; type: "holdings" | "costs"; currency: string; litres: number }) {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<ReplayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [cursor, setCursor] = useState<number | undefined>();
  const raf = useRef<number | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api<ReplayData>(`/api/plans/${planId}/replay?days=${days}`)
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, [planId, days]);

  useEffect(() => {
    if (!data) return;
    setCursor(undefined);
    const start = performance.now();
    const run = (now: number) => {
      const p = Math.min(1, (now - start) / 10_000);
      setProgress(p);
      if (p < 1) raf.current = requestAnimationFrame(run);
    };
    raf.current = requestAnimationFrame(run);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [data]);

  const toPerLitre = (v: number) => v / litres;
  const series = data
    ? [
        {
          label: "Without Locke",
          color: "var(--color-faint)",
          dashed: true,
          values: data.points.map((p) => (type === "costs" ? toPerLitre(p.without) : p.without)),
        },
        {
          label: "With Locke",
          color: "var(--color-accent)",
          values: data.points.map((p) => (type === "costs" ? toPerLitre(p.with) : p.with)),
        },
      ]
    : [];
  const fmt = (n: number) => (type === "holdings" ? usd(n, 0) : local(n, currency, 0));
  const first = data?.points[0];
  const last = data?.points[data.points.length - 1];
  const fmtDate = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">Replay</h3>
          <p className="text-xs text-faint">
            Simulation on Strike&apos;s daily mark prices: {type === "holdings" ? "portfolio value" : "monthly fuel cost per litre"}, price effects
            only.
          </p>
        </div>
        <div className="flex gap-1">
          {[30, 90, 180].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`num rounded border px-2.5 py-1 text-xs ${days === d ? "border-accent text-accent" : "border-line text-muted"}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4">
        <ErrorNote error={error} />
        {!data && !error && (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        )}
        {data && (
          <>
            <LineChart
              series={series}
              progress={progress}
              cursor={cursor}
              format={fmt}
              xLabels={first && last ? [fmtDate(first.t), fmtDate(last.t)] : undefined}
            />
            <input
              type="range"
              aria-label="Scrub replay"
              min={0}
              max={Math.max(0, data.points.length - 1)}
              value={cursor ?? Math.max(0, Math.round(progress * data.points.length) - 1)}
              onChange={(e) => {
                if (raf.current) cancelAnimationFrame(raf.current);
                setProgress(1);
                setCursor(Number(e.target.value));
              }}
              className="mt-3 w-full"
            />
            {last && (
              <p className="mt-2 text-xs text-faint">
                Funding not in the lines: at today&apos;s rate ({pct(data.hourlyFundingRate * 24, 3)}/day) this hedge would have{" "}
                {last.funding >= 0 ? "received" : "paid"} about {usd(Math.abs(last.funding), 0)} over the window. Strike publishes no
                funding history, so treat this as a projection.
              </p>
            )}
            {data.shortened && (
              <p className="mt-2 text-xs text-faint">Strike has {data.availableDays} days of history for this market; the replay uses what exists.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
