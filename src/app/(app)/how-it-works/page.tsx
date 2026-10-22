import type { Metadata } from "next";
import Link from "next/link";
import { Arrow, Card, Display, Eyebrow, SUBTLE } from "@/components/ui";

export const metadata: Metadata = { title: "How it works — Locke" };

const STEPS = [
  ["Describe", "ADA you hold, or litres you buy. Locke reads your wallet balance for you."],
  ["Preview", "Hedge size, margin, fees, the daily cost of protection, and outcomes from −50% to +50%."],
  ["Fund", "Sign one ADA deposit. Locke sets isolated margin and opens the hedge on Strike."],
  ["Watch", "Locke alerts you before Strike would, with a top-up ready to sign."],
];

const LADDER = [
  { tone: "paper" as const, k: "Watch", v: "20% from liquidation or 50% margin ratio", d: "The plan card turns amber. Nothing to do yet." },
  { tone: "watch" as const, k: "Action needed", v: "10% from liquidation or 60% margin ratio", d: "One-tap top-up, sized to move liquidation 25% away." },
  { tone: "danger" as const, k: "Margin call", v: "70% margin ratio", d: "Strike's level. Locke repeats the alert." },
  { tone: "ink" as const, k: "Liquidation", v: "100% margin ratio", d: "Strike closes the position. Locke tells you at once." },
];

export default function HowItWorksPage() {
  return (
    <div className="animate-rise space-y-3">
      <section className="pb-10 pt-6 sm:pt-12">
        <Eyebrow className="mb-6 text-ink-2">How it works</Eyebrow>
        <Display size="xl" lead="Describe. Preview. Fund. Watch." rest="Every plan, the same four steps." className="max-w-[14ch]" />
      </section>

      <Card tone="ink" as="section" className="px-6 py-10 sm:px-10">
        <ol className="grid grid-cols-1 gap-px overflow-hidden rounded-[18px] bg-paper/10 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="bg-ink p-6 sm:p-8">
              <span className="num text-[13px] text-lime">0{i + 1}</span>
              <h2 className="display mt-10 text-[22px]">{t}</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-paper/55">{d}</p>
            </li>
          ))}
        </ol>
      </Card>

      <section className="grid grid-cols-1 gap-3 pt-16 md:grid-cols-2">
        <Card tone="cobalt" id="holdings" className="scroll-mt-24">
          <Eyebrow className={SUBTLE.cobalt}>Holdings plan · ADA-USD · short</Eyebrow>
          <h2 className="display mt-10 text-[28px]">Protect what you hold</h2>
          <p className={`mt-4 text-[15px] leading-relaxed ${SUBTLE.cobalt}`}>
            Locke sells ADA on Strike against the share of your treasury you choose to protect. If ADA falls, the hedge gains what the
            treasury loses. It&apos;s a direct hedge: the only gaps are funding, fees and any share you leave unhedged. The ADA in your wallet
            never moves and stays staked.
          </p>
        </Card>
        <Card tone="lime" id="costs" className="scroll-mt-24">
          <Eyebrow className={SUBTLE.lime}>Operating costs plan · WTI-USD · long</Eyebrow>
          <h2 className="display mt-10 text-[28px]">Manage what you buy</h2>
          <p className={`mt-4 text-[15px] leading-relaxed ${SUBTLE.lime}`}>
            Locke buys crude on Strike for the part of your pump price you believe moves with oil. If crude rises, the hedge gains and pays
            down your fuel bill. It&apos;s a partial hedge: local prices also move with exchange rates, taxes and policy, which WTI doesn&apos;t
            capture. Each month you can close the slice that matched the fuel you used.
          </p>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-3 pt-16 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Display as="h2" size="lg" lead="Alerts before Strike's." rest="Not after." />
          <p className="mt-6 max-w-[44ch] text-[17px] leading-relaxed text-ink-2">
            A Cardano deposit takes minutes to confirm, so Locke warns early: on margin health, and on how close the price is to
            liquidation. Each plan has its own isolated margin, so trouble in one never touches the other.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-7">
          {LADDER.map((r) => (
            <Card key={r.k} tone={r.tone} className="flex min-h-[150px] flex-col">
              <Eyebrow className={SUBTLE[r.tone]}>{r.v}</Eyebrow>
              <h3 className="display mt-auto pt-8 text-[22px]">{r.k}</h3>
              <p className={`mt-2 text-[14px] ${SUBTLE[r.tone]}`}>{r.d}</p>
            </Card>
          ))}
        </div>
      </section>

      <Card as="section" className="!mt-16 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <Display as="h2" size="md" lead="Ready when you are." rest="It takes a few minutes." />
        <Link href="/connect" className="inline-flex h-14 shrink-0 items-center gap-3 self-start rounded-full bg-cobalt px-7 text-paper hover:bg-cobalt-deep sm:self-auto">
          Connect a wallet <Arrow />
        </Link>
      </Card>
    </div>
  );
}
