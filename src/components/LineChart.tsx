"use client";

import { useMemo } from "react";

export interface Series {
  label: string;
  color: string;
  values: number[];
  dashed?: boolean;
  /** Fill the area under this series. */
  area?: boolean;
}

/**
 * Dependency-free SVG line chart. `progress` (0..1) reveals the lines left to right for the
 * replay animation; `cursor` pins a readout to one point.
 */
export function LineChart({
  series,
  height = 240,
  progress = 1,
  cursor,
  format = (n) => n.toFixed(2),
  xLabels,
  onDark = false,
}: {
  series: Series[];
  height?: number;
  progress?: number;
  cursor?: number;
  format?: (n: number) => string;
  xLabels?: [string, string];
  onDark?: boolean;
}) {
  const W = 800;
  const H = height;
  const pad = { l: 4, r: 4, t: 14, b: 26 };
  const n = Math.max(0, ...series.map((s) => s.values.length));
  const { min, max } = useMemo(() => {
    const all = series.flatMap((s) => s.values).filter(Number.isFinite);
    if (!all.length) return { min: 0, max: 1 };
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    if (hi - lo < 1e-9) {
      hi += Math.abs(hi) * 0.05 || 1;
      lo -= Math.abs(lo) * 0.05 || 1;
    }
    const m = (hi - lo) * 0.1;
    return { min: lo - m, max: hi + m };
  }, [series]);
  const grid = onDark ? "rgb(255 255 255 / 0.1)" : "var(--color-line)";
  const faint = onDark ? "rgb(255 255 255 / 0.5)" : "var(--color-ink-3)";
  if (n < 2) return <div className={`flex h-40 items-center justify-center text-sm ${onDark ? "text-paper/50" : "text-ink-3"}`}>Not enough data yet</div>;

  const x = (i: number) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const shown = Math.max(2, Math.round(progress * n));
  const readAt = cursor != null ? Math.min(cursor, n - 1) : shown - 1;

  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={series.map((s) => s.label).join(" versus ")}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={pad.l} x2={W - pad.r} y1={pad.t + f * (H - pad.t - pad.b)} y2={pad.t + f * (H - pad.t - pad.b)} stroke={grid} strokeWidth="1" />
        ))}
        {series.map((s) => {
          // Missing values (null/NaN from a gap in the data) are skipped rather than drawn as "NaN" coordinates.
          const pts = s.values
            .slice(0, shown)
            .map((v, i) => [x(i), y(v)] as const)
            .filter(([, py]) => Number.isFinite(py));
          const d = pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
          return (
            <g key={s.label}>
              {s.area && pts.length > 1 && (
                <polygon
                  points={`${pts[0][0]},${H - pad.b} ${d} ${pts[pts.length - 1][0]},${H - pad.b}`}
                  fill={s.color}
                  opacity={0.12}
                />
              )}
              <polyline points={d} fill="none" stroke={s.color} strokeWidth={s.dashed ? 2 : 3} strokeDasharray={s.dashed ? "6 6" : undefined} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
        {series.map((s) =>
          Number.isFinite(s.values[readAt]) ? <circle key={s.label} cx={x(readAt)} cy={y(s.values[readAt])} r={5} fill={s.color} stroke={onDark ? "#0c0c0d" : "#fff"} strokeWidth="2" /> : null
        )}
        {cursor != null && <line x1={x(readAt)} x2={x(readAt)} y1={pad.t} y2={H - pad.b} stroke={faint} strokeDasharray="2 4" />}
        {xLabels && (
          <g fontSize="13" fill={faint} style={{ fontFamily: "var(--font-mono)" }}>
            <text x={pad.l} y={H - 6}>{xLabels[0]}</text>
            <text x={W - pad.r} y={H - 6} textAnchor="end">{xLabels[1]}</text>
          </g>
        )}
      </svg>
      <figcaption className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
        {series.map((s) => (
          <span key={s.label} className={`flex items-center gap-2 ${onDark ? "text-paper/60" : "text-ink-2"}`}>
            <span className="inline-block h-[3px] w-5 rounded-full" style={{ background: s.color }} />
            {s.label}
            <span className={`num ${onDark ? "text-paper" : "text-ink"}`}>{Number.isFinite(s.values[readAt]) ? format(s.values[readAt]) : "—"}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
