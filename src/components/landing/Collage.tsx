// Hero backdrop: columns of Locke "product shots" drifting past, like a moving moodboard.
// Pure markup (server-safe). Decorative, so hidden from assistive tech; motion stops under
// prefers-reduced-motion via the global rule. Tiles fall in on load in a diagonal wave, a column
// pauses while hovered, and posters cropped at the tile edge pull back into full view on hover.

import { FallIn } from "@/components/DropIn";
import { price } from "@/lib/ui/format";

type Tile = { h: string; node: React.ReactNode };

// Poster type that sits cropped at the tile edge and settles fully inside it on hover.
const POSTER = "display absolute transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]";

function Spark({ up = false, color = "currentColor" }: { up?: boolean; color?: string }) {
  const d = up ? "M0 30 L12 26 L22 28 L34 18 L46 21 L58 10 L70 13 L82 4" : "M0 6 L12 9 L22 7 L34 16 L46 13 L58 22 L70 19 L82 28";
  return (
    <svg viewBox="0 0 82 34" className="h-10 w-full" preserveAspectRatio="none">
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function tiles(eth: number | null, wti: number | null): Tile[][] {
  const t = (h: string, node: React.ReactNode): Tile => ({ h, node });
  return [
    [
      t("h-56", (
        <div className="flex h-full flex-col bg-cobalt p-4 text-paper">
          <span className="eyebrow text-paper/70">Protected value</span>
          <span className="num mt-auto text-[28px] leading-none">$12,480</span>
          <span className="mt-3 h-2 rounded-full bg-paper/20"><span className="block h-full w-[18%] rounded-full bg-paper" /></span>
        </div>
      )),
      t("h-72", (
        <div className="relative h-full overflow-hidden bg-ink">
          <span className={`${POSTER} -left-6 top-6 text-[104px] leading-[0.8] text-lime group-hover:left-4 group-hover:top-5 group-hover:text-[64px]`}>hed<br />ge</span>
        </div>
      )),
      t("h-44", (
        <div className="flex h-full flex-col bg-paper p-4">
          <span className="num text-[12px] text-ink-3">ETH/USD · Veranta</span>
          <span className="num mt-1 text-[24px]">{eth ? price(eth) : "—"}</span>
          <span className="mt-auto text-cobalt"><Spark /></span>
        </div>
      )),
    ],
    [
      t("h-80", (
        <div className="relative h-full overflow-hidden bg-danger">
          <span className={`${POSTER} bottom-2 left-3 text-[60px] leading-none text-paper group-hover:bottom-4 group-hover:left-4 group-hover:text-[44px]`}>−50%</span>
          <span className="eyebrow absolute left-4 top-4 text-paper/80">ETH moves</span>
        </div>
      )),
      t("h-52", (
        <div className="flex h-full flex-col bg-lime p-4 text-ink">
          <span className="eyebrow text-ink/60">Effective fuel price</span>
          <span className="num mt-auto text-[26px] leading-none">NGN 1,250</span>
          <span className="mt-2 text-[13px] text-ink/60">per litre, held flat</span>
        </div>
      )),
      t("h-48", (
        <div className="flex h-full flex-col bg-paper p-4">
          <span className="eyebrow text-ink-2">Replay · 90d</span>
          <svg viewBox="0 0 100 50" className="mt-auto h-24 w-full" preserveAspectRatio="none">
            <path d="M0 30 L10 26 L20 32 L30 18 L40 22 L50 10 L60 16 L70 6 L80 14 L90 9 L100 18" fill="none" stroke="var(--color-ink-3)" strokeWidth="1.5" strokeDasharray="3 3" />
            <path d="M0 30 L10 29 L20 30 L30 27 L40 28 L50 25 L60 27 L70 24 L80 26 L90 25 L100 27" fill="none" stroke="var(--color-cobalt)" strokeWidth="2.5" />
          </svg>
        </div>
      )),
    ],
    [
      t("h-48", (
        <div className="flex h-full flex-col bg-ink p-4 text-paper">
          <span className="inline-flex w-fit rounded-full bg-lime px-3 py-1 text-[12px] text-ink">Keeper</span>
          <span className="display mt-auto text-[22px]">Margin +$48</span>
          <span className="mt-3 inline-flex h-9 w-fit items-center rounded-full bg-paper px-4 text-[13px] text-ink">Within your vault&apos;s limits</span>
        </div>
      )),
      t("h-72", (
        <div className="relative h-full overflow-hidden bg-[#0000ff]">
          <span className={`${POSTER} -right-4 top-2 text-[104px] leading-[0.82] text-paper group-hover:right-4 group-hover:top-10 group-hover:text-[60px]`}>Base</span>
          <span className="eyebrow absolute bottom-4 left-4 text-paper/80">Your vault · your keys</span>
        </div>
      )),
      t("h-52", (
        <div className="flex h-full flex-col bg-watch p-4 text-ink">
          <span className="eyebrow text-ink/60">Watch</span>
          <span className="display mt-auto text-[24px] leading-tight">20% from liquidation</span>
        </div>
      )),
    ],
    [
      t("h-44", (
        <div className="flex h-full flex-col bg-paper p-4">
          <span className="num text-[12px] text-ink-3">WTI/USD · Veranta</span>
          <span className="num mt-1 text-[24px]">{wti ? price(wti) : "—"}</span>
          <span className="mt-auto text-ink"><Spark up /></span>
        </div>
      )),
      t("h-80", (
        <div className="relative h-full overflow-hidden bg-lime">
          <span className={`${POSTER} -left-3 bottom-0 text-[120px] leading-[0.78] text-ink group-hover:bottom-4 group-hover:left-4 group-hover:text-[64px]`}>WTI</span>
          <span className="eyebrow absolute left-4 top-4 text-ink/60">Diesel · 2,000 L/month</span>
        </div>
      )),
      t("h-56", (
        <div className="flex h-full flex-col bg-cobalt p-4 text-paper">
          <span className="eyebrow text-paper/70">Margin health</span>
          <div className="mt-auto space-y-2">
            {[22, 58, 12].map((w) => (
              <span key={w} className="block h-2 rounded-full bg-paper/20"><span className="block h-full rounded-full bg-paper" style={{ width: `${w}%` }} /></span>
            ))}
          </div>
        </div>
      )),
    ],
    [
      t("h-64", (
        <div className="flex h-full flex-col bg-paper p-4">
          <span className="eyebrow text-ink-2">Create vault</span>
          <span className="num mt-auto text-[24px] leading-none">375.55 USDC</span>
          <span className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-cobalt text-[14px] text-paper">Approve in wallet →</span>
        </div>
      )),
      t("h-48", (
        <div className="relative h-full overflow-hidden bg-ink">
          <span className="display absolute left-3 top-3 text-[44px] leading-none text-paper">+25%</span>
          <span className="eyebrow absolute bottom-4 left-4 text-lime">Crude rises · bill holds</span>
        </div>
      )),
      t("h-56", (
        <div className="flex h-full flex-col bg-paper p-4 text-ink">
          <span className="eyebrow text-ink-2">Sign in with Base</span>
          <span className="mt-auto inline-flex items-center gap-3 text-[20px]">
            <span className="inline-block h-6 w-6 rounded-[4px] bg-[#0000ff]" />
            Passkey, no seed phrase
          </span>
        </div>
      )),
    ],
  ];
}

export function Collage({ eth, wti }: { eth: number | null; wti: number | null }) {
  const cols = tiles(eth, wti);
  return (
    <FallIn aria-hidden className="absolute inset-0 grid grid-cols-2 gap-2 overflow-hidden p-2 sm:grid-cols-3 lg:grid-cols-5">
      {cols.map((col, i) => (
        <div key={i} className={`overflow-hidden ${i >= 2 ? "hidden sm:block" : ""} ${i >= 3 ? "sm:hidden lg:block" : ""}`}>
          {/* Two copies stacked so a -50% translate loops seamlessly. */}
          <div
            className={`${i % 2 ? "animate-drift-down" : "animate-drift-up"} hover:[animation-play-state:paused]`}
            style={{ animationDuration: `${48 + i * 9}s` }}
          >
            {[0, 1].map((copy) => (
              <div key={copy} className="flex flex-col gap-2 pb-2">
                {col.concat(col).map((tile, k) => (
                  <div
                    key={k}
                    // Candidates to fall in: the copy in view at load (drift-down columns start at
                    // -50%, showing the second copy). <FallIn> picks the ones actually on screen.
                    className={`${copy === i % 2 ? "fall " : ""}group ${tile.h} shrink-0 overflow-hidden rounded-[14px] transition-transform duration-300 hover:scale-[0.985]`}
                  >
                    {tile.node}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </FallIn>
  );
}
