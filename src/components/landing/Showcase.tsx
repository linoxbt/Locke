// "Who Locke protects": example businesses, each with a typographic visual. Swipes sideways on
// phones (scroll-snap), three columns from lg.

import Link from "next/link";

const ITEMS: { lead: string; rest: string; href: string; visual: React.ReactNode }[] = [
  {
    lead: "Stake pools",
    rest: "that keep running through grid outages",
    href: "/how-it-works#costs",
    visual: (
      <div className="relative h-full bg-ink">
        <span className="display absolute -bottom-3 left-3 text-[108px] leading-none text-lime">24/7</span>
        <span className="num absolute right-4 top-4 rounded-full bg-paper/10 px-3 py-1 text-[12px] text-paper">diesel · WTI</span>
      </div>
    ),
  },
  {
    lead: "Treasuries in ADA",
    rest: "that hold their value when ADA falls",
    href: "/how-it-works#holdings",
    visual: (
      <div className="relative h-full bg-cobalt">
        <span className="display absolute left-4 top-3 text-[96px] leading-[0.85] text-paper">ADA</span>
        <span className="num absolute bottom-4 right-4 text-[34px] text-paper">−30% → 0%</span>
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
          {[60, 72, 55, 90, 68, 100, 64].map((h, i) => (
            <span key={i} className="flex-1 rounded-t-md bg-ink" style={{ height: `${h}%`, opacity: 0.25 + i * 0.1 }} />
          ))}
        </div>
        <span className="display absolute left-4 top-3 text-[40px] text-ink">NGN 1,250/L</span>
      </div>
    ),
  },
  {
    lead: "Cardano teams",
    rest: "paid in ADA, spending in dollars",
    href: "/how-it-works#holdings",
    visual: (
      <div className="relative h-full bg-paper">
        <span className="display absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[64px] leading-none text-ink">
          ₳ <span className="text-ink-3">→</span> $
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
          <path d="M0 80 L30 70 L60 74 L90 50 L120 56 L150 30 L180 36 L200 18" fill="none" stroke="white" strokeWidth="3" />
          <path d="M0 80 L200 80" stroke="white" strokeWidth="3" strokeDasharray="6 6" opacity="0.6" />
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
            <span key={i} className={`rounded-full ${i === 4 ? "bg-cobalt" : "bg-paper"}`} />
          ))}
        </div>
      </div>
    ),
  },
];

export function Showcase() {
  return (
    <div className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 [scrollbar-width:none] sm:-mx-14 sm:px-14 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-x-8 lg:gap-y-12 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
      {ITEMS.map((it) => (
        <Link key={it.lead} href={it.href} className="group w-[78vw] max-w-[420px] shrink-0 snap-start lg:w-auto lg:max-w-none">
          <div className="aspect-[5/3] overflow-hidden rounded-[10px] transition-transform duration-500 group-hover:scale-[1.01]">{it.visual}</div>
          <p className="mt-3 text-[15px] sm:text-[17px]">
            {it.lead} <span className="text-ink-3">{it.rest}</span>
          </p>
        </Link>
      ))}
    </div>
  );
}
