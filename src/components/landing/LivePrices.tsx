"use client";

import { useEffect, useRef, useState } from "react";
import { pct } from "@/lib/ui/format";

/** A Strike perp's mark, index and hourly funding rate (a fraction). */
export type Mark = { mark: number; index: number; fundingRate: number } | null;
/** A Veranta market on Base: its price and what holding Locke's side costs per day (%). */
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

function Price({ symbol, venue, value, note, started }: { symbol: string; venue: string; value: number | null; note: string; started: boolean }) {
  const shown = useTween(value, started);

  const prev = useRef(value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    if (before == null || value == null || before === value) return;
    setFlash(value > before ? "up" : "down");
    const id = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(id);
  }, [value]);

  return (
    <div>
      <dt className="num flex items-center gap-2 text-[12px] text-paper/50">
        {symbol} · {venue}
        {flash && <span className={flash === "up" ? "text-lime" : "text-danger"}>{flash === "up" ? "▲" : "▼"}</span>}
      </dt>
      <dd
        className={`num mt-1 text-[24px] leading-none transition-colors duration-700 sm:text-[34px] ${
          flash === "up" ? "text-lime" : flash === "down" ? "text-danger" : ""
        }`}
      >
        {shown == null ? "—" : live(shown)}
      </dd>
      <dd className="num mt-2 text-[12px] text-paper/50">{note}</dd>
    </div>
  );
}

type Prices = { ada: Mark; wti: Mark; eth: Quote; baseWti: Quote };

/**
 * Live prices on both sides Locke hedges on: Strike's ADA and WTI marks (Cardano) and Veranta's ETH
 * and WTI (Base). They count up when scrolled into view, then poll while visible.
 */
export function LivePrices(initial: Prices) {
  const ref = useRef<HTMLDListElement>(null);
  const [p, setP] = useState<Prices>(initial);
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
    const strike = async () => {
      const r = await fetch("/api/market", { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as { ada: Mark; wti: Mark };
      if (!cancelled) setP((prev) => ({ ...prev, ada: d.ada ?? prev.ada, wti: d.wti ?? prev.wti }));
    };
    const base = async () => {
      const r = await fetch("/api/base/markets", { cache: "no-store" });
      if (!r.ok) return;
      const { markets } = (await r.json()) as { markets: { pairIndex: number; price: number | null; carryPctPerHour: number | null }[] };
      const pick = (i: number): Quote => {
        const m = markets.find((x) => x.pairIndex === i);
        return m?.price ? { price: m.price, carryPctPerDay: m.carryPctPerHour == null ? null : m.carryPctPerHour * 24 } : null;
      };
      if (!cancelled) setP((prev) => ({ ...prev, eth: pick(0) ?? prev.eth, baseWti: pick(96) ?? prev.baseWti }));
    };
    // A market that didn't answer this time (or is closed) keeps its last price; the next poll retries.
    const tick = () => {
      if (document.hidden) return;
      strike().catch(() => {});
      base().catch(() => {});
    };
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [visible]);

  const funding = (m: Mark) => (m ? `funding ${pct(m.fundingRate * 24, 3)}/day` : "—");
  return (
    <dl ref={ref} className="mt-auto grid grid-cols-2 gap-x-4 gap-y-5 pt-6">
      <Price symbol="ADA-USD" venue="Strike" value={p.ada?.mark ?? null} note={funding(p.ada)} started={started} />
      <Price symbol="WTI-USD" venue="Strike" value={p.wti?.mark ?? null} note={funding(p.wti)} started={started} />
      <Price symbol="ETH/USD" venue="Base" value={p.eth?.price ?? null} note={carry(p.eth?.carryPctPerDay)} started={started} />
      <Price symbol="WTI/USD" venue="Base" value={p.baseWti?.price ?? null} note={carry(p.baseWti?.carryPctPerDay)} started={started} />
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
