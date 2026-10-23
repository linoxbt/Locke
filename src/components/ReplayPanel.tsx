"use client";

import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/ui/api";
import { local, pct, usd } from "@/lib/ui/format";
import { LineChart } from "./LineChart";
import { Slider } from "./form";
import { Display, ErrorNote, Spinner } from "./ui";

interface ReplayData {
  days: number;
  availableDays: number;
  shortened: boolean;
  hourlyFundingRate: number;
  points: { t: number; price: number; without: number; with: number; funding: number }[];
}

const DURATION_MS = 10_000;

/** Without Locke vs with Locke against Strike's real mark history, animated over ~10 s with a scrubber. Renders on ink. */
export function ReplayPanel({ planId, type, currency, litres }: { planId: string; type: "holdings" | "costs"; currency: string; litres: number }) {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<ReplayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [cursor, setCursor] = useState<number | undefined>();
  const [playing, setPlaying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api<ReplayData>(`/api/plans/${planId}/replay?days=${days}`)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [planId, days, attempt]);

  const play = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    setCursor(undefined);
    // Reduced motion: show the finished replay instead of animating it.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setProgress(1);
      setPlaying(false);
      return;
    }
    setPlaying(true);
    const start = performance.now();
    const run = (now: number) => {
      const p = Math.min(1, (now - start) / DURATION_MS);
      setProgress(p);
      if (p < 1) raf.current = requestAnimationFrame(run);
      else setPlaying(false);
    };
    raf.current = requestAnimationFrame(run);
  };

  useEffect(() => {
    if (data) play();
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [data]);

  const perLitre = (v: number) => (type === "costs" ? v / litres : v);
  const series = data
    ? [
        { label: "Without Locke", color: "rgb(255 255 255 / 0.45)", dashed: true, values: data.points.map((p) => perLitre(p.without)) },
        { label: "With Locke", color: "var(--color-lime)", area: true, values: data.points.map((p) => perLitre(p.with)) },
      ]
    : [];
  const fmt = (n: number) => (type === "holdings" ? usd(n, 0) : local(n, currency, 0));
  const first = data?.points[0];
  const last = data?.points[data.points.length - 1];
  const fmtDate = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const scrubValue = cursor ?? Math.max(0, Math.round(progress * (data?.points.length ?? 1)) - 1);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <Display
            as="h2"
            size="md"
            lead="Replay."
            rest={type === "holdings" ? "Your treasury against real ADA prices." : "Your fuel bill against real crude prices."}
            restClass="text-paper/45"
            className="max-w-[22ch]"
          />
          <p className="mt-3 text-[13px] text-paper/50">
            Simulation on Strike&apos;s daily mark prices, {type === "holdings" ? "portfolio value" : "fuel cost per litre"}, price effects only.
          </p>
        </div>
        <div className="flex gap-1 rounded-full bg-paper/10 p-1" role="radiogroup" aria-label="Replay window">
          {[30, 90, 180].map((d) => (
            <button
              key={d}
              role="radio"
              aria-checked={days === d}
              onClick={() => setDays(d)}
              className={`num h-10 rounded-full px-4 text-[13px] transition ${days === d ? "bg-paper text-ink" : "text-paper/60 hover:text-paper"}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="mt-7">
        {error && (
          <div className="space-y-3">
            <ErrorNote error={error} />
            <button onClick={() => setAttempt((n) => n + 1)} className="h-10 rounded-full bg-paper/10 px-4 text-[13px] text-paper hover:bg-paper/20">
              Try again
            </button>
          </div>
        )}
        {!data && !error && (
          <div className="flex h-60 items-center justify-center">
            <Spinner className="border-lime border-t-transparent" />
          </div>
        )}
        {data && (
          <>
            <LineChart
              onDark
              series={series}
              progress={progress}
              cursor={cursor}
              format={fmt}
              xLabels={first && last ? [fmtDate(first.t), fmtDate(last.t)] : undefined}
            />
            <div className="mt-6 flex items-center gap-4 text-lime">
              <button
                onClick={play}
                disabled={playing}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-lime text-ink disabled:opacity-60"
                aria-label="Replay animation"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                  <path d="M3 1.5v11l9-5.5z" fill="currentColor" />
                </svg>
              </button>
              <Slider
                label="Scrub replay"
                min={0}
                max={Math.max(1, data.points.length - 1)}
                value={scrubValue}
                className="text-lime"
                onChange={(v) => {
                  if (raf.current) cancelAnimationFrame(raf.current);
                  setPlaying(false);
                  setProgress(1);
                  setCursor(v);
                }}
              />
            </div>
            {last && (
              <p className="mt-6 text-[13px] leading-relaxed text-paper/50">
                Funding isn&apos;t in the lines. At today&apos;s rate ({pct(data.hourlyFundingRate * 24, 3)}/day) this hedge would have{" "}
                {last.funding >= 0 ? "received" : "paid"} about {usd(Math.abs(last.funding), 0)} over the window. Strike publishes no funding history,
                so treat it as a projection.
                {data.shortened && ` Strike has ${data.availableDays} days of history for this market; the replay uses what exists.`}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
