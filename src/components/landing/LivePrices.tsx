"use client";

import { useEffect, useRef, useState } from "react";
import { pct } from "@/lib/ui/format";

/** A Veranta market on the landing: its price and what holding Locke's side costs per day (%). */
export type Quote = { price: number; carryPctPerDay: number | null } | null;

const POLL_MS = 5_000;
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

// One more decimal than the app's usual price format, so small moves show.
const live = (n: number) => (n < 10 ? n.toFixed(5) : n.toFixed(3));

function carry(c: number | null | undefined): string {
  if (c == null) return "—";
  return c < 0 ? `paid ${pct(-c / 100, 3)}/day` : `costs ${pct(c / 100, 3)}/day`;
}

function Price({ symbol, side, q, started }: { symbol: string; side: string; q: Quote; started: boolean }) {
  const target = q?.price ?? null;
  const shown = useTween(target, started);

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
        {shown == null ? "—" : live(shown)}
      </dd>
      <dd className="num mt-2 text-[12px] text-paper/50">{side}</dd>
      <dd className="num mt-0.5 text-[12px] text-paper/50">{carry(q?.carryPctPerDay)}</dd>
    </div>
  );
}

/** Live ETH and WTI prices from Veranta on Base: count up when scrolled into view, then poll while visible. */
export function LivePrices({ eth, wti }: { eth: Quote; wti: Quote }) {
  const ref = useRef<HTMLDListElement>(null);
  const [quotes, setQuotes] = useState({ eth, wti });
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
        const r = await fetch("/api/base/markets", { cache: "no-store" });
        if (!r.ok) return;
        const { markets } = (await r.json()) as { markets: { pairIndex: number; price: number | null; carryPctPerHour: number | null }[] };
        const pick = (i: number): Quote => {
          const m = markets.find((x) => x.pairIndex === i);
          return m?.price ? { price: m.price, carryPctPerDay: m.carryPctPerHour == null ? null : m.carryPctPerHour * 24 } : null;
        };
        // A market that didn't answer this time (or is closed) keeps its last price.
        if (!cancelled) setQuotes((prev) => ({ eth: pick(0) ?? prev.eth, wti: pick(96) ?? prev.wti }));
      } catch {
        // Keep showing the last price; the next poll retries.
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
      <Price symbol="ETH/USD" side="Locke shorts it" q={quotes.eth} started={started} />
      <Price symbol="WTI/USD" side="Locke goes long" q={quotes.wti} started={started} />
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
