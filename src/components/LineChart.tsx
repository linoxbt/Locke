"use client";

import { useMemo } from "react";

export interface Series {
  label: string;
  color: string;
  values: number[];
  dashed?: boolean;
}

/**
 * Minimal SVG line chart. `progress` (0..1) reveals the lines left to right for the replay
 * animation; `cursor` marks a point with a readout.
 */
export function LineChart({
  series,
  height = 220,
  progress = 1,
  cursor,
  format = (n) => n.toFixed(2),
  xLabels,
}: {
  series: Series[];
  height?: number;
  progress?: number;
  cursor?: number;
  format?: (n: number) => string;
  xLabels?: [string, string];
}) {
  const W = 600;
  const H = height;
  const pad = { l: 8, r: 8, t: 12, b: 20 };
  const n = Math.max(...series.map((s) => s.values.length), 0);
  const { min, max } = useMemo(() => {
    const all = series.flatMap((s) => s.values).filter((v) => isFinite(v));
    if (!all.length) return { min: 0, max: 1 };
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    if (hi - lo < 1e-9) {
      hi += Math.abs(hi) * 0.05 || 1;
      lo -= Math.abs(lo) * 0.05 || 1;
    }
    const m = (hi - lo) * 0.08;
    return { min: lo - m, max: hi + m };
  }, [series]);
  if (n < 2) return <div className="flex h-40 items-center justify-center text-sm text-faint">Not enough data yet</div>;

  const x = (i: number) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const shown = Math.max(2, Math.round(progress * n));

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={series.map((s) => s.label).join(" vs ")}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={pad.l} x2={W - pad.r} y1={pad.t + f * (H - pad.t - pad.b)} y2={pad.t + f * (H - pad.t - pad.b)} stroke="var(--color-line)" strokeWidth="1" />
        ))}
        {series.map((s) => {
          const pts = s.values.slice(0, shown).map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
          return (
            <polyline
              key={s.label}
              points={pts}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "5 4" : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
        {cursor != null && cursor < n && (
          <g>
            <line x1={x(cursor)} x2={x(cursor)} y1={pad.t} y2={H - pad.b} stroke="var(--color-faint)" strokeDasharray="2 3" />
            {series.map((s) => (isFinite(s.values[cursor]) ? <circle key={s.label} cx={x(cursor)} cy={y(s.values[cursor])} r={3.5} fill={s.color} /> : null))}
          </g>
        )}
        {xLabels && (
          <g className="num" fontSize="11" fill="var(--color-faint)">
            <text x={pad.l} y={H - 4}>{xLabels[0]}</text>
            <text x={W - pad.r} y={H - 4} textAnchor="end">{xLabels[1]}</text>
          </g>
        )}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs">
        {series.map((s) => {
          const idx = cursor != null ? Math.min(cursor, s.values.length - 1) : Math.min(shown, s.values.length) - 1;
          return (
            <span key={s.label} className="flex items-center gap-2 text-muted">
              <span className="inline-block h-0.5 w-4" style={{ background: s.color }} />
              {s.label}
              <span className="num text-text">{isFinite(s.values[idx]) ? format(s.values[idx]) : "—"}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
