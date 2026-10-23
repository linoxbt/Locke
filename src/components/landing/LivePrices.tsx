"use client";

import { useEffect, useRef, useState } from "react";
import { pct } from "@/lib/ui/format";

type Mark = { mark: number; index: number; fundingRate: number } | null;

const POLL_MS = 3_000;
const COUNT_MS = 1_400;
const TWEEN_MS = 900;
const ease = (t: number) => 1 - Math.pow(1 - t, 5);

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Follows `target`: counts up from zero over COUNT_MS once `started` first turns true, then glides
 * to each new value over TWEEN_MS. Before that it just mirrors the target (the server-rendered value).
 */
function useTween(target: number | null, started: boolean) {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  const counted = useRef(false);
  useEffect(() => {
    if (target == null) return;
    const count = started && !counted.current;
    if (!started || reducedMotion()) {
      current.current = target;
      setValue(target);
      return;
    }
    counted.current = true;
    const from = count ? 0 : (current.current ?? target);
    const duration = count ? COUNT_MS : TWEEN_MS;
    if (from === target) return;
    let raf = 0;
    const t0 = performance.now();
    const run = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const v = from + (target - from) * ease(p);
      current.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(run);
    };
    raf = requestAnimationFrame(run);
    return () => cancelAnimationFrame(raf);
  }, [target, started]);
  return value;
}

// One more decimal than the app's usual price format: Strike's marks move in small steps.
const live = (n: number, big: boolean) => (n < 10 ? n.toFixed(big ? 5 : 6) : n.toFixed(3));

function Price({ symbol, m, started }: { symbol: string; m: Mark; started: boolean }) {
  const target = m?.mark ?? null;
  const shown = useTween(target, started);
  const index = useTween(m?.index ?? null, started);

  const prev = useRef(target);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = target;
    if (before == null || target == null || before === target) return;
    setFlash(target > before ? "up" : "down");
    const id = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(id);
  }, [target]);

  return (
    <div>
      <dt className="num flex items-center gap-2 text-[12px] text-paper/50">
        {symbol}
        {flash && <span className={flash === "up" ? "text-lime" : "text-danger"}>{flash === "up" ? "▲" : "▼"}</span>}
      </dt>
      <dd
        className={`num mt-1 text-[26px] leading-none transition-colors duration-700 sm:text-[38px] ${
          flash === "up" ? "text-lime" : flash === "down" ? "text-danger" : ""
        }`}
      >
        {shown == null ? "—" : live(shown, true)}
      </dd>
      <dd className="num mt-2 text-[12px] text-paper/50">index {index == null ? "—" : live(index, false)}</dd>
      <dd className="num mt-0.5 text-[12px] text-paper/50">funding {m ? `${pct(m.fundingRate * 24, 3)}/day` : "—"}</dd>
    </div>
  );
}

/** Live ADA and WTI marks: count up when scrolled into view, then poll while visible. */
export function LivePrices({ ada, wti }: { ada: Mark; wti: Mark }) {
  const ref = useRef<HTMLDListElement>(null);
  const [marks, setMarks] = useState({ ada, wti });
  const [visible, setVisible] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      setVisible(e.isIntersecting);
      if (e.isIntersecting) setStarted(true);
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/market", { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as { ada: Mark; wti: Mark };
        // A market that didn't answer this time keeps its last mark.
        if (!cancelled) setMarks((prev) => ({ ada: d.ada ?? prev.ada, wti: d.wti ?? prev.wti }));
      } catch {
        // Keep showing the last mark; the next poll retries.
      }
    };
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [visible]);

  return (
    <dl ref={ref} className="mt-auto grid grid-cols-2 gap-4">
      <Price symbol="ADA-USD" m={marks.ada} started={started} />
      <Price symbol="WTI-USD" m={marks.wti} started={started} />
    </dl>
  );
}

/** Pulsing "live" marker for the prices tile heading. */
export function LiveDot() {
  return (
    <span className="relative ml-2 inline-flex h-2 w-2 align-middle" aria-label="live">
      <span className="absolute inset-0 animate-ping rounded-full bg-lime opacity-75" />
      <span className="relative h-2 w-2 rounded-full bg-lime" />
    </span>
  );
}
