import Link from "next/link";
import { Collage } from "@/components/landing/Collage";
import { PlanDemo } from "@/components/landing/PlanDemo";
import { Showcase } from "@/components/landing/Showcase";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { optionalSession } from "@/lib/server/pageAuth";
import { getMarkPrice } from "@/lib/strike/client";
import { pct, price } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

const wrap = "mx-auto w-full max-w-[1440px] px-5 sm:px-14";

export default async function HomePage() {
  const [session, ada, wti] = await Promise.all([
    optionalSession(),
    getMarkPrice("ADA-USD").catch(() => null),
    getMarkPrice("WTI-USD").catch(() => null),
  ]);
  const start = session ? "/protect" : "/connect";

  return (
    <>
      {/* Hero: one card over a drifting collage. */}
      <section className="relative h-[100svh] min-h-[620px] overflow-hidden bg-mist">
        <Collage ada={ada?.mark ?? null} wti={wti?.mark ?? null} />
        <div className="relative z-10 flex h-full items-center justify-center px-4">
          <div className="w-full max-w-[620px] animate-rise rounded-[14px] bg-paper p-5 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.35)] sm:p-6">
            <h1 className="display text-[30px] leading-[1.04] sm:text-[44px]">
              Protect what your business holds. <span className="text-ink-3">Manage what it needs to buy, with hedges on Strike.</span>
            </h1>
            <Link
              href={start}
              className="mt-16 flex h-14 items-center justify-center rounded-full bg-cobalt text-[18px] text-paper transition-colors hover:bg-cobalt-deep sm:mt-24 sm:h-[84px] sm:text-[22px]"
            >
              {session ? "New protection plan" : "Try Locke"}
            </Link>
          </div>
        </div>
      </section>

      {/* Showcase */}
      <section className={`${wrap} pb-24 pt-24 sm:pb-32 sm:pt-36`}>
        <h2 className="display text-[40px] sm:text-[56px]">Who Locke protects</h2>
        <div className="mt-10 sm:mt-16">
          <Showcase />
        </div>
      </section>

      {/* Black interlude with a live demo */}
      <section className="bg-ink px-4 py-20 text-paper sm:py-32">
        <h2 className="display mx-auto max-w-[22ch] text-center text-[28px] leading-[1.05] sm:text-[44px]">
          Describe it, preview it, fund it. <span className="text-paper/50">Then move the price and watch the plan hold.</span>
        </h2>
        <div className="mt-12 sm:mt-16">
          {ada && wti ? (
            <PlanDemo ada={ada.mark} wti={wti.mark} />
          ) : (
            <p className="text-center text-paper/50">Live prices are unavailable right now.</p>
          )}
        </div>
        <p className="mt-10 text-center text-[14px] text-paper/50">From your exposure to a live hedge on Strike in a few minutes</p>
      </section>

      {/* Bento */}
      <section className={`${wrap} py-24 sm:py-36`}>
        <h2 className="display text-[40px] sm:text-[56px]">Everything a protection plan needs</h2>
        <div className="mt-10 grid grid-cols-2 gap-2 sm:mt-16 sm:gap-3 lg:grid-cols-4">
          <Tile tone="bg-ink text-paper" className="col-span-2 row-span-2 min-h-[300px] sm:min-h-[460px]" title="Live Strike prices" sub="Sized from the mark price the moment you preview">
            <dl className="mt-auto grid grid-cols-2 gap-4">
              {(
                [
                  ["ADA-USD", ada],
                  ["WTI-USD", wti],
                ] as const
              ).map(([s, m]) => (
                <div key={s}>
                  <dt className="num text-[12px] text-paper/50">{s}</dt>
                  <dd className="num mt-1 text-[34px] leading-none sm:text-[56px]">{m ? price(m.mark) : "—"}</dd>
                  <dd className="num mt-2 text-[12px] text-paper/50">funding {m ? `${pct(m.fundingRate * 24, 3)}/day` : "—"}</dd>
                </div>
              ))}
            </dl>
          </Tile>
          <Tile tone="bg-cobalt text-paper" className="min-h-[200px] sm:min-h-[224px]" title="Isolated margin" sub="Trouble in one plan never touches another" />
          <Tile tone="bg-danger text-paper" className="min-h-[200px] sm:min-h-[224px]" title="Alerts before Strike's" sub="At 10% from liquidation, not after" />
          <Tile tone="bg-lime text-ink" className="min-h-[200px] sm:min-h-[224px]" title="Replay" sub="Your plan against 180 days of real prices">
            <svg viewBox="0 0 100 40" className="mt-auto h-14 w-full" preserveAspectRatio="none" aria-hidden>
              <path d="M0 26 L12 20 L24 28 L36 12 L48 18 L60 6 L72 14 L84 8 L100 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.5" />
              <path d="M0 26 L12 25 L24 26 L36 23 L48 24 L60 21 L72 23 L84 22 L100 23" fill="none" stroke="currentColor" strokeWidth="2.5" />
            </svg>
          </Tile>
          <Tile tone="bg-watch text-ink" className="min-h-[200px] sm:min-h-[224px]" title="One-tap top-up" sub="Sized to move liquidation 25% away" />
          <Tile tone="bg-mist text-ink" className="col-span-2 min-h-[200px] sm:min-h-[224px]" title="Still staked, still voting" sub="Hedged ADA never leaves your wallet. Only margin moves." />
          <Tile tone="bg-paper text-ink" className="col-span-2 min-h-[200px] sm:min-h-[224px]" title="Your wallet signs every move" sub="Deposits and withdrawals need your signature, and withdrawals only go back to your wallet." />
        </div>
      </section>

      {/* Closing CTA */}
      <section className="px-3 pb-20 sm:px-6 sm:pb-28">
        <h2 className={`${wrap} display text-[40px] sm:text-[56px]`}>Protect what your business runs on</h2>
        <Link
          href={start}
          className="mt-10 flex h-[120px] items-center justify-center rounded-full bg-cobalt text-[32px] text-paper transition-colors hover:bg-cobalt-deep sm:mt-14 sm:h-[220px] sm:text-[64px] lg:h-[296px]"
        >
          <span className="display">Get started</span>
        </Link>
        <p className="mt-14 text-center text-[14px] text-ink-3">Works with</p>
        <ul className="mx-auto mt-6 flex max-w-[1100px] flex-wrap items-center justify-center gap-x-10 gap-y-4 text-[22px] text-ink sm:text-[26px]">
          {["Strike", "Cardano", "Eternl", "Lace", "Vespr", "Koios"].map((n) => (
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
  title: string;
  sub: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col rounded-[10px] p-4 sm:p-5 ${tone} ${className}`}>
      <h3 className="display text-[22px] leading-tight sm:text-[28px]">{title}</h3>
      {children}
      <p className={`text-[12px] leading-snug opacity-70 sm:text-[13px] ${children ? "mt-4" : "mt-auto pt-6"}`}>{sub}</p>
    </div>
  );
}
