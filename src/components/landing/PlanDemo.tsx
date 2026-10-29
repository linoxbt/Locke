"use client";

import { useEffect, useRef, useState } from "react";
import { calibratedCrudeShare, PUMP_PRICES } from "@/lib/domain/fuel";
import { costsExposureUsd, costsOutcome } from "@/lib/domain/plans";
import type { CostsInputs } from "@/lib/domain/types";
import { local, usd } from "@/lib/ui/format";

/** ETH the demo treasury holds, fully hedged with a short of the same size. */
const HOLD_ETH = 20;
// Lagos diesel at the dated reference pump price, with the crude share Locke would calibrate for it
// (filled in from the live WTI mark), sized exactly as a real plan is.
const COST: CostsInputs = {
  fuelType: "diesel",
  country: "NG",
  litresPerMonth: 2000,
  pumpPrice: PUMP_PRICES.NG.diesel!.price,
  fxRate: 1530,
  currency: "NGN",
  months: 3,
  crudeSharePct: 46,
  leverage: 1,
  bufferPct: 25,
};

type PlanKind = "holdings" | "costs";

// Autoplay: the price glides between these moves (%), easing in and out, pausing at each one.
const WAYPOINTS: Record<PlanKind, number[]> = {
  holdings: [-30, -50, -15, 25, 0],
  costs: [25, 45, 10, -20, 0],
};
const GLIDE_MS = 1_700;
const HOLD_MS = 700;
const RESUME_MS = 4_000;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function outcome(type: PlanKind, move: number, eth: number, wti: number) {
  const m = move / 100;
  if (type === "holdings") {
    const without = HOLD_ETH * eth * (1 + m);
    return { without, with: without + HOLD_ETH * (eth - eth * (1 + m)) };
  }
  const c = { ...COST, crudeSharePct: calibratedCrudeShare("diesel", wti, COST.fxRate, COST.pumpPrice) ?? COST.crudeSharePct };
  return costsOutcome(c, costsExposureUsd(c) / wti, wti, wti * (1 + m));
}

/**
 * Drag a price move and watch a plan hold. Uses Locke's own outcome functions. While on screen it
 * plays itself: the price glides through a few moves and the figures follow. Dragging takes over
 * (autoplay resumes after a few idle seconds); the pause button stops it for good.
 */
export function PlanDemo({ eth, wti }: { eth: number; wti: number }) {
  const [type, setType] = useState<PlanKind>("holdings");
  const [move, setMove] = useState(-30);
  const target = outcome(type, move, eth, wti);
  // Displayed figures ease towards the target, so switching plans rolls the numbers over.
  const [shown, setShown] = useState({ without: target.without, with: target.with });
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const [idleUntil, setIdleUntil] = useState(0);
  const [reduced, setReduced] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const live = useRef({ move, type, target, shown });
  live.current = { move, type, target, shown };

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Ease the displayed figures towards the current outcome. The loop stops once settled and starts
  // again when the target moves; off screen (or with reduced motion) the figures jump straight there.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.max(0, now - last);
      last = now;
      const { target: t, shown: s } = live.current;
      if (s.without === t.without && s.with === t.with) return;
      const k = reduced || !visible ? 1 : 1 - Math.exp(-dt / 110);
      let next = { without: s.without + (t.without - s.without) * k, with: s.with + (t.with - s.with) * k };
      if (Math.abs(t.without - next.without) < 0.5 && Math.abs(t.with - next.with) < 0.5) next = { without: t.without, with: t.with };
      live.current.shown = next;
      setShown(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [reduced, visible, target.without, target.with]);

  // Autoplay: glide the price from wherever it is through the plan's waypoints.
  const autoplay = visible && !paused && !reduced;
  useEffect(() => {
    if (!autoplay) return;
    const wait = idleUntil - Date.now();
    let raf = 0;
    let timer = 0;
    const run = () => {
      const points = WAYPOINTS[live.current.type];
      let i = points.indexOf(Math.round(live.current.move));
      i = i < 0 ? 0 : (i + 1) % points.length;
      let from = live.current.move;
      let start = performance.now();
      const frame = (now: number) => {
        if (document.hidden) start = now;
        const p = Math.min(1, (now - start) / GLIDE_MS);
        setMove(from + (points[i] - from) * easeInOut(p));
        if (now - start >= GLIDE_MS + HOLD_MS) {
          from = points[i];
          i = (i + 1) % points.length;
          start = now;
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    };
    timer = window.setTimeout(run, Math.max(0, wait));
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [autoplay, idleUntil, type]);

  const fmt = type === "holdings" ? (n: number) => usd(n, 0) : (n: number) => local(n, "NGN", 0);
  const max = Math.max(target.without, target.with) * 1.05;
  const shownMove = Math.round(move);

  return (
    <div ref={ref} className="mx-auto w-full max-w-[760px] rounded-[20px] bg-paper p-4 text-ink sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-full bg-mist p-1" role="radiogroup" aria-label="Plan type">
          {(
            [
              ["holdings", "20 ETH treasury"],
              ["costs", "2,000 L diesel a month"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="radio"
              aria-checked={type === k}
              onClick={() => setType(k)}
              className={`h-10 rounded-full px-4 text-[14px] transition ${type === k ? "bg-ink text-paper" : "text-ink-2"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="num text-[13px] text-ink-3">
            {type === "holdings" ? "ETH" : "Crude"} moves{" "}
            <span className={`inline-block w-[4ch] text-right ${shownMove < 0 ? "text-danger" : shownMove > 0 ? "text-ok" : ""}`}>
              {shownMove > 0 ? "+" : shownMove < 0 ? "−" : ""}
              {Math.abs(shownMove)}%
            </span>
          </span>
          {!reduced && (
            <button
              onClick={() => setPaused((v) => !v)}
              aria-label={paused ? "Play the demo" : "Pause the demo"}
              className="grid h-8 w-8 place-items-center rounded-full bg-mist text-ink-2 transition-colors hover:bg-line hover:text-ink"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                {paused ? <path d="M2 1v8l7-4z" fill="currentColor" /> : <path d="M2 1h2v8H2zM6 1h2v8H6z" fill="currentColor" />}
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[
          { label: type === "holdings" ? "Treasury without Locke" : "Monthly bill without Locke", v: shown.without, bar: "bg-mist", text: "text-ink-2" },
          { label: type === "holdings" ? "Treasury with Locke" : "Monthly bill with Locke", v: shown.with, bar: type === "holdings" ? "bg-cobalt" : "bg-lime", text: "text-ink" },
        ].map((r) => (
          <div key={r.label} className="rounded-2xl bg-canvas p-4 sm:p-5">
            <div className="text-[14px] text-ink-2">{r.label}</div>
            <div className={`num mt-2 text-[26px] leading-none sm:text-[32px] ${r.text}`}>{fmt(r.v)}</div>
            <div className="mt-4 h-2 rounded-full bg-paper">
              <div className={`h-full rounded-full ${r.bar}`} style={{ width: `${Math.min(100, Math.max(2, (r.v / max) * 100))}%` }} />
            </div>
          </div>
        ))}
      </div>

      <label className="mt-8 block">
        <span className="sr-only">Price move</span>
        <input
          type="range"
          min={-50}
          max={50}
          // "any" so autoplay can glide the thumb smoothly; your own input snaps to whole percents.
          step="any"
          value={move}
          onChange={(e) => {
            setMove(Math.round(Number(e.target.value)));
            setIdleUntil(Date.now() + RESUME_MS);
          }}
          onPointerDown={() => setIdleUntil(Date.now() + RESUME_MS)}
          onKeyDown={() => setIdleUntil(Date.now() + RESUME_MS)}
          className="w-full text-ink"
          style={{ ["--fill" as string]: `${((move + 50) / 100) * 100}%` }}
        />
      </label>
      <div className="num mt-1 flex justify-between text-[12px] text-ink-3">
        <span>−50%</span>
        <span>0</span>
        <span>+50%</span>
      </div>
      <p className="mt-4 text-[13px] text-ink-3">
        Illustration at today&apos;s prices on Veranta, fully hedged, before funding and fees. Your own plan shows these numbers for your amounts.
      </p>
    </div>
  );
}
