import Link from "next/link";
import { Arrow, Card, Display, Eyebrow, SUBTLE } from "@/components/ui";
import { optionalSession } from "@/lib/server/pageAuth";
import { getMarkPrice, type MarkPrice } from "@/lib/strike/client";
import { pct, price } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

async function markets(): Promise<{ ada: MarkPrice | null; wti: MarkPrice | null }> {
  const [ada, wti] = await Promise.allSettled([getMarkPrice("ADA-USD"), getMarkPrice("WTI-USD")]);
  return { ada: ada.status === "fulfilled" ? ada.value : null, wti: wti.status === "fulfilled" ? wti.value : null };
}

export default async function HomePage() {
  const [session, m] = await Promise.all([optionalSession(), markets()]);
  const primary = session ? { href: "/portfolio", label: "Open your portfolio" } : { href: "/connect", label: "Connect a Cardano wallet" };

  return (
    <div className="animate-rise space-y-3">
      <section className="pb-8 pt-6 sm:pb-14 sm:pt-12">
        <Eyebrow className="mb-6 text-ink-2">Protection plans · built on Strike</Eyebrow>
        <Display size="xl" lead="Protect what your business holds." rest="Manage what it needs to buy." className="max-w-[15ch]" />
        <p className="mt-8 max-w-[52ch] text-lg leading-relaxed text-ink-2">
          Tell Locke what you want to protect — ADA in your treasury, or the fuel you buy every month. Locke opens, sizes and watches a hedge
          for it on Strike. Your ADA stays in your wallet, still staked. Only the margin moves.
        </p>
        <div className="mt-10 flex flex-wrap gap-2">
          <Link href={primary.href} className="inline-flex h-16 items-center gap-3 rounded-full bg-cobalt px-8 text-lg font-medium text-paper hover:bg-cobalt-deep">
            {primary.label} <Arrow />
          </Link>
          <Link href="/how-it-works" className="inline-flex h-16 items-center rounded-full bg-paper px-8 text-lg ring-1 ring-inset ring-line hover:ring-ink">
            How it works
          </Link>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Link href={session ? "/protect/holdings" : "/how-it-works#holdings"} className="group lg:col-span-5">
          <Card tone="cobalt" className="flex h-full min-h-[300px] flex-col transition-transform duration-300 group-hover:-translate-y-1">
            <div className="flex items-start justify-between">
              <Eyebrow className={SUBTLE.cobalt}>01 · Holdings</Eyebrow>
              <span className="num rounded-full bg-paper/15 px-3 py-1 text-[12px]">ADA-USD</span>
            </div>
            <h2 className="display mt-auto pt-10 text-[36px] sm:text-[48px]">Protect what you hold</h2>
            <p className={`mt-3 text-[15px] ${SUBTLE.cobalt}`}>A direct hedge. If ADA falls, the hedge gains what your treasury loses.</p>
          </Card>
        </Link>
        <Link href={session ? "/protect/costs" : "/how-it-works#costs"} className="group lg:col-span-4">
          <Card tone="lime" className="flex h-full min-h-[300px] flex-col transition-transform duration-300 group-hover:-translate-y-1">
            <div className="flex items-start justify-between">
              <Eyebrow className={SUBTLE.lime}>02 · Operating costs</Eyebrow>
              <span className="num rounded-full bg-ink/10 px-3 py-1 text-[12px]">WTI-USD</span>
            </div>
            <h2 className="display mt-auto pt-10 text-[36px] sm:text-[48px]">Manage what you buy</h2>
            <p className={`mt-3 text-[15px] ${SUBTLE.lime}`}>A partial hedge on crude for the diesel you burn.</p>
          </Card>
        </Link>
        <Card tone="ink" className="lg:col-span-3">
          <div className="flex items-center justify-between">
            <Eyebrow className={SUBTLE.ink}>Live on Strike</Eyebrow>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lime" aria-label="live" />
          </div>
          <dl className="mt-8 space-y-6">
            {(
              [
                ["ADA-USD", m.ada],
                ["WTI-USD", m.wti],
              ] as const
            ).map(([sym, mk]) => (
              <div key={sym}>
                <dt className="num text-[12px] text-paper/50">{sym}</dt>
                <dd className="num mt-1 text-[32px] leading-none">{mk ? price(mk.mark) : "—"}</dd>
                <dd className="num mt-2 text-[12px] text-paper/50">funding {mk ? `${pct(mk.fundingRate * 24, 3)}/day` : "unavailable"}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Card tone="mist" as="section" className="!mt-3 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <Display as="h2" size="md" lead="Your ADA keeps earning and voting." rest="The hedge lives on Strike." className="max-w-[22ch]" />
        <Link href="/how-it-works" className="inline-flex h-12 shrink-0 items-center gap-2 self-start rounded-full bg-ink px-6 text-paper sm:self-auto">
          See every step <Arrow />
        </Link>
      </Card>

      <footer className="!mt-20 flex flex-col gap-4 border-t border-line pt-8 text-[13px] leading-relaxed text-ink-3 sm:flex-row sm:justify-between">
        <p className="max-w-[70ch]">
          Locke is a tool, not financial advice. Hedges can lose money on their own, and positions can be liquidated if margin runs out. Strike
          has eligibility rules; check{" "}
          <a className="underline underline-offset-4" href="https://docs.strikefinance.org" target="_blank" rel="noreferrer">
            Strike&apos;s restricted persons policy
          </a>{" "}
          before you use it.
        </p>
        <p className="num shrink-0">Built on Strike · Cardano</p>
      </footer>
    </div>
  );
}
