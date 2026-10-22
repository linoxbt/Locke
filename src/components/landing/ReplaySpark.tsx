"use client";

import { useEffect, useRef, useState } from "react";

// Same shape as the replay page: the unprotected line swings, the protected line barely moves.
const WITHOUT = [26, 20, 28, 12, 18, 6, 14, 8, 16];
const WITH = [26, 25, 26, 23, 24, 21, 23, 22, 23];
const XS = [0, 12, 24, 36, 48, 60, 72, 84, 100];
const H = 40;
const LOOP_MS = 5_000;

const toPath = (ys: number[]) => ys.map((y, i) => `${i ? "L" : "M"}${XS[i]} ${y}`).join(" ");

function at(ys: number[], x: number) {
  let i = 1;
  while (i < XS.length - 1 && XS[i] < x) i++;
  const t = (x - XS[i - 1]) / (XS[i] - XS[i - 1]);
  return ys[i - 1] + (ys[i] - ys[i - 1]) * Math.min(1, Math.max(0, t));
}

/** Bento sparkline: draws itself in on scroll, then a cursor keeps sweeping the gap between the lines. */
export function ReplaySpark() {
  const ref = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(false);
  const [visible, setVisible] = useState(false);
  const [x, setX] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      setVisible(e.isIntersecting);
      if (e.isIntersecting) setDrawn(true);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let t0: number | null = null;
    // Let the draw-in finish before the cursor starts.
    const delay = setTimeout(() => {
      const run = (now: number) => {
        t0 ??= now;
        setX((((now - t0) % LOOP_MS) / LOOP_MS) * 100);
        raf = requestAnimationFrame(run);
      };
      raf = requestAnimationFrame(run);
    }, 1_100);
    return () => {
      clearTimeout(delay);
      cancelAnimationFrame(raf);
    };
  }, [visible]);

  const yWith = x == null ? 0 : at(WITH, x);
  const yWithout = x == null ? 0 : at(WITHOUT, x);

  return (
    <div ref={ref} className="relative mt-auto h-14 w-full" aria-hidden>
      <svg viewBox={`0 0 100 ${H}`} className="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none">
        <defs>
          <clipPath id="replay-reveal">
            <rect
              className="replay-clip"
              x="0"
              y="-10"
              width="100"
              height={H + 20}
              style={{ transform: `scaleX(${drawn ? 1 : 0})`, transformOrigin: "0 0", transition: "transform 1.1s cubic-bezier(0.22, 1, 0.36, 1)" }}
            />
          </clipPath>
        </defs>
        <g clipPath="url(#replay-reveal)">
          <path
            d={toPath(WITHOUT)}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="4 4"
            opacity="0.5"
            vectorEffect="non-scaling-stroke"
            className="animate-dash-march"
          />
          <path d={toPath(WITH)} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
      {x != null && (
        <>
          <span
            className="absolute w-px bg-current opacity-40"
            style={{ left: `${x}%`, top: `${(Math.min(yWith, yWithout) / H) * 100}%`, height: `${(Math.abs(yWith - yWithout) / H) * 100}%` }}
          />
          <span className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-current bg-lime" style={{ left: `${x}%`, top: `${(yWithout / H) * 100}%` }} />
          <span className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" style={{ left: `${x}%`, top: `${(yWith / H) * 100}%` }} />
        </>
      )}
    </div>
  );
}
