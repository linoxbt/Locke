// "Who Locke protects": example businesses, each with a typographic visual, most of them in
// motion (CSS loops marked .loop, stopped under reduced motion). Swipes sideways on phones
// (scroll-snap), three columns from lg.

import Link from "next/link";
import { DropIn } from "@/components/DropIn";

// Heartbeat across the 24/7 card: flat, a spike, flat again. Drawn in a 0–200 × 0–100 box.
const PULSE = "M0 55 L60 55 L72 55 L80 30 L88 78 L96 44 L102 55 L200 55";
// Bars of a fuel price that keeps moving, each on its own rhythm (height %, low point, seconds).
const BARS: [number, number, number][] = [
  [60, 0.55, 2.6],
  [72, 0.7, 3.1],
  [55, 0.5, 2.2],
  [90, 0.62, 3.4],
  [68, 0.58, 2.8],
  [100, 0.66, 3.7],
  [64, 0.52, 2.4],
];
// The order the highlighted member hops through the 3×3 grid.
const HOPS = [4, 0, 8, 2, 6, 1, 7, 3, 5];
const HOP_S = 0.55;

const ITEMS: { lead: string; rest: string; href: string; visual: React.ReactNode }[] = [
  {
    lead: "Stake pools and node operators",
    rest: "that keep running through grid outages",
    href: "/how-it-works#costs",
    visual: (
      <div className="relative h-full bg-ink">
        <svg viewBox="0 0 200 100" className="absolute inset-x-0 top-[18%] h-[46%] w-full" preserveAspectRatio="none" aria-hidden>
          <path d={PULSE} pathLength={100} fill="none" stroke="var(--color-lime)" strokeOpacity="0.18" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <path
            d={PULSE}
            pathLength={100}
            fill="none"
            stroke="var(--color-lime)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="26 74"
            vectorEffect="non-scaling-stroke"
            className="loop"
            style={{ animation: "pulse-travel 2.4s linear infinite" }}
          />
        </svg>
        <span
          className="loop display absolute -bottom-3 left-3 text-[72px] leading-none text-lime transition-all duration-500 group-hover:bottom-3"
          style={{ animation: "float-up 5s ease-in-out infinite" }}
        >
          24/7
        </span>
        <span className="num absolute right-4 top-4 flex items-center gap-2 rounded-full bg-paper/10 px-3 py-1 text-[12px] text-paper">
          <span className="loop h-1.5 w-1.5 rounded-full bg-lime" style={{ animation: "blink 1.2s ease-in-out infinite" }} />
          diesel · WTI
        </span>
      </div>
    ),
  },
  {
    lead: "Treasuries in ADA or ETH",
    rest: "that hold their value when the market falls",
    href: "/how-it-works#holdings",
    visual: (
      <div className="relative h-full bg-cobalt">
        <span className="display absolute left-4 top-3 text-[56px] leading-[0.85] text-paper">
          ADA
          <br />
          ETH
        </span>
        <span className="num absolute bottom-4 right-4 text-[26px] text-paper">−30% → 0%</span>
      </div>
    ),
  },
  {
    lead: "Generator fleets",
    rest: "with a fuel bill you can budget",
    href: "/how-it-works#costs",
    visual: (
      <div className="relative h-full bg-lime">
        <div className="absolute inset-x-4 bottom-4 flex h-28 items-end gap-2">
          {BARS.map(([h, lo, sec], i) => (
            <span
              key={i}
              className="loop flex-1 origin-bottom rounded-t-md bg-ink"
              style={{
                height: `${h}%`,
                opacity: 0.25 + i * 0.1,
                ["--lo" as string]: lo,
                animation: `bar-wave ${sec}s ease-in-out ${-i * 0.37}s infinite`,
              }}
            />
          ))}
        </div>
        {/* What the plan holds the fleet's price to, whatever the bars do. */}
        <div className="absolute inset-x-4 bottom-[4.6rem] border-t-2 border-dashed border-ink/70" />
        <span className="num absolute bottom-[4.9rem] right-4 rounded-full bg-lime px-2 text-[11px] text-ink">budget</span>
        <span className="display absolute left-4 top-3 text-[30px] text-ink">NGN 1,250/L</span>
      </div>
    ),
  },
  {
    lead: "Cardano and Base teams",
    rest: "paid in crypto, spending in dollars",
    href: "/how-it-works#holdings",
    visual: (
      <div className="relative h-full bg-paper">
        <span className="display absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[44px] leading-none text-ink">
          ₳ Ξ <span className="text-ink-3">→</span> $
        </span>
      </div>
    ),
  },
  {
    lead: "Logistics businesses",
    rest: "whose margins ride on the price of crude",
    href: "/how-it-works#costs",
    visual: (
      <div className="relative h-full bg-danger">
        <svg viewBox="0 0 200 100" className="absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden>
          <path d="M0 80 L30 70 L60 74 L90 50 L120 56 L150 30 L180 36 L200 18" fill="none" stroke="white" strokeOpacity="0.2" strokeWidth="3" />
          <path
            d="M0 80 L30 70 L60 74 L90 50 L120 56 L150 30 L180 36 L200 18"
            pathLength={100}
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeLinejoin="round"
            strokeDasharray="100 100"
            className="loop"
            style={{ animation: "line-run 4.2s cubic-bezier(0.45, 0, 0.25, 1) infinite" }}
          />
          <path d="M0 80 L200 80" stroke="white" strokeWidth="3" strokeDasharray="4 4" opacity="0.6" className="animate-dash-march" />
        </svg>
        <span className="eyebrow absolute bottom-4 left-4 text-paper/80">crude rises · cost holds</span>
      </div>
    ),
  },
  {
    lead: "Community funds",
    rest: "that can't afford a bad month",
    href: "/how-it-works#holdings",
    visual: (
      <div className="relative h-full bg-mist">
        <div className="absolute inset-6 grid grid-cols-3 gap-2">
          {Array.from({ length: 9 }, (_, i) => (
            <span
              key={i}
              className={`loop rounded-full ${i === 4 ? "bg-cobalt" : "bg-paper"}`}
              style={{ animation: `pip ${HOP_S * 9}s ease-in-out ${HOPS.indexOf(i) * HOP_S}s infinite backwards` }}
            />
          ))}
        </div>
      </div>
    ),
  },
];

export function Showcase() {
  return (
    <DropIn className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 [scrollbar-width:none] sm:-mx-14 sm:px-14 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-x-6 lg:gap-y-10 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
      {ITEMS.map((it) => (
        <Link key={it.lead} href={it.href} className="group w-[70vw] max-w-[340px] shrink-0 snap-start lg:w-auto lg:max-w-none">
          <div className="aspect-[5/3] overflow-hidden rounded-[10px] transition-transform duration-500 group-hover:scale-[1.01]">{it.visual}</div>
          <p className="mt-3 text-[14px] sm:text-[15px]">
            {it.lead} <span className="text-ink-3">{it.rest}</span>
          </p>
        </Link>
      ))}
    </DropIn>
  );
}
