import type { Metadata } from "next";
import Link from "next/link";
import { DropIn } from "@/components/DropIn";
import { Arrow, Card, Display, Eyebrow, SUBTLE } from "@/components/ui";

export const metadata: Metadata = { title: "How it works — Locke" };

const STEPS = [
  ["Describe", "ADA you hold, or litres you buy. Locke can read your wallet balance for you."],
  ["Preview", "Hedge size, margin, fees, the daily cost of protection, and outcomes from −50% to +50%."],
  ["Fund", "Sign one ADA deposit. Locke sets isolated margin and opens the hedge on Strike."],
  ["Watch", "Locke watches margin around the clock and flags a plan the moment it needs a top-up. You see it, with the top-up ready to sign, when you open Locke."],
];

const LADDER = [
  { tone: "paper" as const, k: "Watch", v: "20% from liquidation or margin health 50%", d: "The plan card turns amber. Nothing to do yet." },
  { tone: "watch" as const, k: "Action needed", v: "10% from liquidation or margin health 60%", d: "The plan shows a one-tap top-up, sized to move liquidation 25% away." },
  { tone: "danger" as const, k: "Margin call", v: "Margin health 70%", d: "Strike's level. The plan stays flagged until it's topped up." },
  { tone: "ink" as const, k: "Liquidation", v: "Margin health 100%", d: "Strike closes the position. Locke records it on the plan." },
];

const BASE_POINTS = [
  ["Your own contract", "Sign in with Base and create a vault: one wallet request approves the USDC and creates it, owned by you."],
  ["Limits on Base", "The vault itself caps leverage, hedge size and slippage. Locke's keeper can trade within them and can never withdraw."],
  ["Margin kept topped up", "When margin use reaches 60%, the keeper adds margin from the vault's buffer, back to a safe level."],
  ["Exit any time", "Withdraw, close the hedge or remove Locke's keeper from your own wallet, even if Locke is offline."],
  ["Public proof", "While the hedge is open, a Protected by Locke attestation on Base shows it, so others can check it."],
  ["Protect as you get paid", "Optionally, sign once to move a share of incoming USDC into the vault, never more than your weekly cap."],
];

export default function HowItWorksPage() {
  return (
    <div className="animate-rise space-y-3">
      <section className="pb-10 pt-6 sm:pt-12">
        <Eyebrow className="mb-6 text-ink-2">How it works</Eyebrow>
        <Display size="xl" lead="Describe. Preview. Fund. Watch." rest="Every plan, the same four steps." className="max-w-[14ch]" />
        <p className="mt-6 max-w-[60ch] text-[15px] leading-relaxed text-ink-2">
          Locke runs on two networks: on Cardano with Strike Finance (below), and on Base with Avantis, from a vault you own (
          <Link href="#base" className="underline underline-offset-4 hover:text-ink">
            further down
          </Link>
          ).
        </p>
      </section>

      <Card tone="ink" as="section" className="px-6 py-10 sm:px-10">
        <ol className="grid grid-cols-1 gap-px overflow-hidden rounded-[18px] bg-paper/10 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="bg-ink p-5 sm:p-6">
              <span className="num text-[13px] text-lime">0{i + 1}</span>
              <h2 className="display mt-7 text-[18px]">{t}</h2>
              <p className="mt-3 text-[14px] leading-relaxed text-paper/55">{d}</p>
            </li>
          ))}
        </ol>
      </Card>

      <section className="grid grid-cols-1 gap-3 pt-12 md:grid-cols-2">
        <Card tone="cobalt" id="holdings" className="scroll-mt-24">
          <Eyebrow className={SUBTLE.cobalt}>Holdings plan · ADA-USD · protects against a fall</Eyebrow>
          <h2 className="display mt-7 text-[22px]">Protect what you hold</h2>
          <p className={`mt-4 text-[14px] leading-relaxed ${SUBTLE.cobalt}`}>
            Locke sells ADA on Strike against the share of your treasury you choose to protect. If ADA falls, the hedge gains what the
            treasury loses. It&apos;s a direct hedge: the only gaps are funding, fees and any share you leave unhedged. The ADA in your wallet
            never moves and stays staked.
          </p>
        </Card>
        <Card tone="lime" id="costs" className="scroll-mt-24">
          <Eyebrow className={SUBTLE.lime}>Operating costs plan · WTI-USD · protects against a rise</Eyebrow>
          <h2 className="display mt-7 text-[22px]">Manage what you buy</h2>
          <p className={`mt-4 text-[14px] leading-relaxed ${SUBTLE.lime}`}>
            Locke buys crude on Strike for the part of your pump price you believe moves with oil. If crude rises, the hedge gains and pays
            down your fuel bill. It&apos;s a partial hedge: local prices also move with exchange rates, taxes and policy, which WTI doesn&apos;t
            capture. Each month you can close the slice that matched the fuel you used.
          </p>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-3 pt-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Display as="h2" size="lg" lead="Alerts before Strike's." rest="Not after." />
          <p className="mt-6 max-w-[44ch] text-[15px] leading-relaxed text-ink-2">
            A Cardano deposit takes minutes to confirm, so Locke flags plans early: on margin health, and on how close the price is to
            liquidation. Flags show when you open Locke; it can&apos;t message you or top up outside the app. Each plan has its own isolated
            margin, so trouble in one never touches the other.
          </p>
        </div>
        <DropIn className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-7">
          {LADDER.map((r) => (
            <Card key={r.k} tone={r.tone} className="flex min-h-[116px] flex-col">
              <Eyebrow className={SUBTLE[r.tone]}>{r.v}</Eyebrow>
              <h3 className="display mt-auto pt-8 text-[18px]">{r.k}</h3>
              <p className={`mt-2 text-[13px] ${SUBTLE[r.tone]}`}>{r.d}</p>
            </Card>
          ))}
        </DropIn>
      </section>

      <Card tone="ink" as="section" id="base" className="!mt-12 scroll-mt-24 px-6 py-10 sm:px-10">
        <Eyebrow className="text-lime">On Base · with Avantis</Eyebrow>
        <Display as="h2" size="lg" lead="A vault you own." rest="Locke hedges from it within limits you set." restClass="text-paper/55" className="mt-6 max-w-[22ch]" />
        <ul className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-[18px] bg-paper/10 sm:grid-cols-2 lg:grid-cols-3">
          {BASE_POINTS.map(([t, d]) => (
            <li key={t} className="bg-ink p-5 sm:p-6">
              <h3 className="display text-[17px]">{t}</h3>
              <p className="mt-3 text-[14px] leading-relaxed text-paper/60">{d}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card as="section" className="!mt-12 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <Display as="h2" size="md" lead="Ready when you are." rest="It takes a few minutes." />
        <Link href="/connect" className="inline-flex h-12 shrink-0 items-center gap-3 self-start rounded-full bg-cobalt px-7 text-paper hover:bg-cobalt-deep sm:self-auto">
          Get started <Arrow />
        </Link>
      </Card>
    </div>
  );
}
