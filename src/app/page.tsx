import Link from "next/link";
import { DropIn } from "@/components/DropIn";
import { Collage } from "@/components/landing/Collage";
import { LiveDot, LivePrices, type Quote } from "@/components/landing/LivePrices";
import { PlanDemo } from "@/components/landing/PlanDemo";
import { ReplaySpark } from "@/components/landing/ReplaySpark";
import { Showcase } from "@/components/landing/Showcase";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { BASE_MARKETS } from "@/lib/base/contracts";
import { optionalBaseSession } from "@/lib/server/basePages";
import { optionalSession } from "@/lib/server/pageAuth";
import { getMarkPrice } from "@/lib/strike/client";
import { getMarkets, getSignedPrice } from "@/lib/veranta/client";

export const dynamic = "force-dynamic";

const wrap = "mx-auto w-full max-w-[1440px] px-5 sm:px-14";

/** A Veranta market's price and the daily carry on the side Locke takes; null when it can't be read (or is closed). */
async function quote(pairIndex: number): Promise<Quote> {
  const [markets, signed] = await Promise.all([getMarkets().catch(() => null), getSignedPrice(pairIndex).catch(() => null)]);
  if (!signed) return null;
  const m = markets?.find((x) => x.index === pairIndex);
  const buy = BASE_MARKETS.find((b) => b.pairIndex === pairIndex)?.buy ?? false;
  return { price: signed.price, carryPctPerDay: m ? (buy ? m.carryPctPerHour.long : m.carryPctPerHour.short) * 24 : null };
}

export default async function HomePage() {
  // Locke hedges on Strike (Cardano) and on Veranta (Base): the page shows live prices from both.
  const [strike, base, ada, wti, eth, baseWti] = await Promise.all([
    optionalSession(),
    optionalBaseSession(),
    getMarkPrice("ADA-USD").catch(() => null),
    getMarkPrice("WTI-USD").catch(() => null),
    quote(0),
    quote(96),
  ]);
  const crude = wti?.mark ?? baseWti?.price ?? null;
  const mark = (m: typeof ada) => (m ? { mark: m.mark, index: m.index, fundingRate: m.fundingRate } : null);
  // Signed in on either side: straight to a new plan there. Otherwise /connect, which offers both
  // Sign in with Base and the Cardano wallets.
  const start = strike ? { href: "/protect", label: "New protection plan" } : base ? { href: "/base/new", label: "New vault" } : { href: "/connect", label: "Try Locke" };

  return (
    <>
      {/* Hero: one card over a drifting collage. */}
      <section className="relative h-[100svh] min-h-[560px] overflow-hidden bg-mist">
        <Collage ada={ada?.mark ?? null} eth={eth?.price ?? null} />
        {/* The overlay lets hover through to the collage; only the card itself takes the pointer. */}
        <div className="pointer-events-none relative z-10 flex h-full items-center justify-center px-4">
          <div className="pointer-events-auto w-full max-w-[520px] animate-rise rounded-[14px] bg-paper p-5 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.35)] sm:p-6">
            <h1 className="display text-[24px] leading-[1.04] sm:text-[32px]">
              Protect what your business holds. <span className="text-ink-3">Manage what it buys, with hedges and from a vault you own.</span>
            </h1>
            <Link
              href={start.href}
              className="mt-10 flex h-12 items-center justify-center rounded-full bg-cobalt text-[16px] text-paper transition-colors hover:bg-cobalt-deep sm:mt-14 sm:h-14 sm:text-[18px]"
            >
              {start.label}
            </Link>
          </div>
        </div>
      </section>

      {/* Showcase */}
      <section className={`${wrap} pb-16 pt-16 sm:pb-24 sm:pt-24`}>
        <h2 className="display text-[26px] sm:text-[34px]">Who Locke protects</h2>
        <div className="mt-8 sm:mt-10">
          <Showcase />
        </div>
      </section>

      {/* Black interlude with a live demo */}
      <section className="bg-ink px-4 py-14 text-paper sm:py-20">
        <h2 className="display mx-auto max-w-[22ch] text-center text-[22px] leading-[1.05] sm:text-[32px]">
          Describe it, preview it, fund it. <span className="text-paper/50">Then move the price and watch the plan hold.</span>
        </h2>
        <div className="mt-8 sm:mt-10">
          {crude != null && (ada || eth) ? (
            <PlanDemo ada={ada?.mark ?? null} eth={eth?.price ?? null} wti={crude} />
          ) : (
            <p className="text-center text-paper/50">Live prices are unavailable right now.</p>
          )}
        </div>
        <p className="mt-10 text-center text-[14px] text-paper/50">From your exposure to a live hedge on Strike or Base in a few minutes</p>
      </section>

      {/* Bento */}
      <section className={`${wrap} py-16 sm:py-24`}>
        <h2 className="display text-[26px] sm:text-[34px]">Everything a protection plan needs</h2>
        <DropIn className="mt-8 grid grid-cols-2 gap-2 sm:mt-10 sm:gap-3 lg:grid-cols-4">
          <Tile
            tone="bg-ink text-paper"
            className="col-span-2 row-span-2 min-h-[220px] sm:min-h-[340px]"
            title={
              <>
                Live prices on Strike and Base
                <LiveDot />
              </>
            }
            sub="Plans are sized from these prices the moment you preview"
          >
            <LivePrices ada={mark(ada)} wti={mark(wti)} eth={eth} baseWti={baseWti} />
          </Tile>
          <Tile tone="bg-[#0000ff] text-paper" className="min-h-[150px] sm:min-h-[168px]" title="A vault you own" sub="On Base: its own contract, and only you can withdraw" />
          <Tile tone="bg-cobalt text-paper" className="min-h-[150px] sm:min-h-[168px]" title="Isolated margin" sub="On Strike: trouble in one plan never touches another" />
          <Tile tone="bg-lime text-ink" className="min-h-[150px] sm:min-h-[168px]" title="Replay" sub="Your plan against 180 days of real prices">
            <ReplaySpark />
          </Tile>
          <Tile tone="bg-watch text-ink" className="min-h-[150px] sm:min-h-[168px]" title="Margin kept topped up" sub="One tap on Strike. On Base the keeper does it, within your vault's limits." />
          <Tile tone="bg-mist text-ink" className="col-span-2 min-h-[150px] sm:min-h-[168px]" title="Still staked, still voting" sub="On Cardano, hedged ADA never leaves your wallet. Only margin moves." />
          <Tile tone="bg-paper text-ink" className="col-span-2 min-h-[150px] sm:min-h-[168px]" title="Your wallet signs every move" sub="Sign in with Base or a Cardano wallet. Withdrawals only go back to you, and on Base you can exit even if Locke is offline." />
        </DropIn>
      </section>

      {/* Closing CTA */}
      <section className="pb-14 sm:pb-20">
        {/* Button centred above the headline, at every width. */}
        <div className={`${wrap} flex flex-col items-center gap-5 text-center`}>
          <Link
            href={start.href}
            className="inline-flex h-11 shrink-0 items-center rounded-full bg-cobalt px-5 text-[15px] text-paper transition-colors hover:bg-cobalt-deep"
          >
            Get started
          </Link>
          <h2 className="display text-[26px] sm:text-[34px]">Protect what your business runs on</h2>
        </div>
        <p className="mt-10 text-center text-[13px] text-ink-3">Works with</p>
        <ul className="mx-auto mt-6 flex max-w-[1100px] flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[17px] text-ink sm:text-[19px]">
          {["Strike", "Cardano", "Eternl", "Lace", "Vespr", "Base", "Base Account", "Veranta", "USDC"].map((n) => (
            <li key={n} className="display">
              {n}
            </li>
          ))}
        </ul>
      </section>

      <SiteFooter />
    </>
  );
}

function Tile({
  tone,
  title,
  sub,
  className = "",
  children,
}: {
  tone: string;
  title: React.ReactNode;
  sub: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col rounded-[10px] p-4 sm:p-5 ${tone} ${className}`}>
      <h3 className="display text-[18px] leading-tight sm:text-[20px]">{title}</h3>
      {children}
      <p className={`text-[12px] leading-snug sm:text-[13px] ${children ? "mt-4" : "mt-auto pt-6"}`}>{sub}</p>
    </div>
  );
}
