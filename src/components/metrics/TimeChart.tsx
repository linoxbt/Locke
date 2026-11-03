"use client";

import { useEffect, useRef, useState } from "react";

export interface TimePoint {
  t: string;
  v: number;
}

type Format = "usd" | "count";

const PAD = { top: 16, right: 16, bottom: 28, left: 56 };
const BAR_MAX = 24;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function compact(v: number, format: Format): string {
  const s = v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${+(v / 1e3).toFixed(0)}K` : v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return format === "usd" ? `$${s}` : s;
}

function full(v: number, format: Format): string {
  return format === "usd" ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : v.toLocaleString("en-US");
}

const day = (iso: string, week: boolean) =>
  (week ? "Week of " : "") + new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * A single series over time: an area with a crosshair (kind "area") or columns with a tooltip on
 * each bar (kind "columns"). Hover, touch and arrow keys all move the readout; the table view
 * beside the chart holds every value without hovering.
 */
export function TimeChart({
  points,
  kind,
  format,
  label,
  empty,
  week = false,
  height = 220,
}: {
  points: TimePoint[];
  kind: "area" | "columns";
  format: Format;
  label: string;
  empty: string;
  week?: boolean;
  height?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  const top = Math.max(0, ...points.map((p) => p.v));
  // Counts get whole-number ticks: a top that divides into four steps.
  const max = format === "count" ? Math.max(4, Math.ceil(top / 4) * 4) : niceMax(Math.max(top, 100));
  const allZero = points.every((p) => p.v === 0);
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const slot = n ? innerW / n : 0;
  const barW = Math.min(BAR_MAX, Math.max(2, slot - 4));
  const x = (i: number) => (kind === "columns" ? PAD.left + slot * i + slot / 2 : PAD.left + (n > 1 ? (innerW * i) / (n - 1) : innerW / 2));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  // Date labels: first, middle and last, so they never collide.
  const xLabels = n ? [...new Set([0, Math.floor((n - 1) / 2), n - 1])] : [];

  const pick = (clientX: number) => {
    const el = wrap.current;
    if (!el || !n) return;
    const px = clientX - el.getBoundingClientRect().left;
    const i = kind === "columns" ? Math.floor((px - PAD.left) / slot) : Math.round(((px - PAD.left) / Math.max(1, innerW)) * (n - 1));
    setActive(Math.min(n - 1, Math.max(0, i)));
  };

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const area = n ? `${line} L${x(n - 1).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z` : "";
  const shown = active ?? null;
  const last = n - 1;

  return (
    <div
      ref={wrap}
      className="relative w-full select-none outline-none focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:ring-offset-2"
      style={{ height }}
      role="img"
      aria-label={label}
      tabIndex={0}
      onPointerMove={(e) => pick(e.clientX)}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerLeave={() => setActive(null)}
      onBlur={() => setActive(null)}
      onKeyDown={(e) => {
        if (!n) return;
        if (e.key === "ArrowRight") setActive((a) => Math.min(last, (a ?? -1) + 1));
        else if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? n) - 1));
        else if (e.key === "Escape") setActive(null);
        else return;
        e.preventDefault();
      }}
    >
      {width > 0 && (
        <svg width={width} height={height} className="block" aria-hidden>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
              <text x={PAD.left - 10} y={y(t)} dy="0.32em" textAnchor="end" className="num fill-ink-3 text-[11px]">
                {compact(t, format)}
              </text>
            </g>
          ))}
          {xLabels.map((i) => (
            <text
              key={i}
              x={kind === "columns" ? (i === 0 ? x(i) - barW / 2 : i === last ? x(i) + barW / 2 : x(i)) : x(i)}
              y={height - 8}
              textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"}
              className="num fill-ink-3 text-[11px]"
            >
              {day(points[i].t, false)}
            </text>
          ))}

          {kind === "area" && n > 0 && !allZero && (
            <>
              <path d={area} fill="var(--color-cobalt)" fillOpacity={0.1} />
              <path d={line} fill="none" stroke="var(--color-cobalt)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={x(last)} cy={y(points[last].v)} r={4} fill="var(--color-cobalt)" stroke="var(--color-paper)" strokeWidth={2} />
            </>
          )}
          {kind === "area" && allZero && n > 0 && <line x1={x(0)} x2={x(last)} y1={y(0)} y2={y(0)} stroke="var(--color-cobalt)" strokeWidth={2} strokeLinecap="round" />}

          {kind === "columns" &&
            points.map((p, i) => {
              if (p.v <= 0) return null;
              const h = Math.max(1, y(0) - y(p.v));
              const bx = x(i) - barW / 2;
              const r = Math.min(4, barW / 2, h);
              // Rounded at the data end, square at the baseline.
              const d = `M${bx} ${y(0)} V${y(0) - h + r} Q${bx} ${y(0) - h} ${bx + r} ${y(0) - h} H${bx + barW - r} Q${bx + barW} ${y(0) - h} ${bx + barW} ${y(0) - h + r} V${y(0)} Z`;
              return <path key={p.t} d={d} fill="var(--color-cobalt)" opacity={shown == null || shown === i ? 1 : 0.55} />;
            })}

          {shown != null && kind === "area" && (
            <>
              <line x1={x(shown)} x2={x(shown)} y1={PAD.top} y2={y(0)} stroke="var(--color-ink-3)" strokeWidth={1} />
              <circle cx={x(shown)} cy={y(points[shown].v)} r={4} fill="var(--color-cobalt)" stroke="var(--color-paper)" strokeWidth={2} />
            </>
          )}
        </svg>
      )}

      {allZero && (
        <p className="pointer-events-none absolute inset-x-0 text-center text-[13px] text-ink-3" style={{ top: PAD.top + innerH / 2 - 10 }}>
          <span className="bg-paper px-2">{empty}</span>
        </p>
      )}

      {shown != null && width > 0 && (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-xl bg-ink px-3 py-2 text-paper shadow-lg"
          style={{ left: Math.min(width - 70, Math.max(70, x(shown))) }}
        >
          <div className="num text-[15px] font-medium">{full(points[shown].v, format)}</div>
          <div className="text-[11px] text-paper/60">{day(points[shown].t, week)}</div>
        </div>
      )}
    </div>
  );
}
