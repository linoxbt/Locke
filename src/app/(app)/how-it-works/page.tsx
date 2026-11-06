import type { Metadata } from "next";
import Link from "next/link";
import { DropIn } from "@/components/DropIn";
import { Arrow, Card, Display, Eyebrow, SUBTLE } from "@/components/ui";

export const metadata: Metadata = { title: "How it works — Locke" };

const STEPS = [
  ["Describe", "ETH or BTC you hold, stocks you hold, or the crude oil or fuel you buy each month. Pick how much to protect and the leverage."],
  ["Preview", "Hedge size, margin, buffer, trading fees, Locke's fee, the vault's limits and what holding the hedge costs on Veranta right now."],
  ["Fund", "Sign in with Base and approve: one request in Base Account (two in other wallets) creates your vault and deposits the USDC. Locke's keeper opens the hedge on Veranta."],
  ["Watch", "The keeper watches margin around the clock and, while the market is open, tops it up from the buffer within your vault's limits."],
];

const LADDER = [
  { tone: "paper" as const, k: "Watch", v: "Margin use 50%", d: "The plan shows amber. Nothing to do yet." },
  { tone: "watch" as const, k: "Top-up", v: "Margin use 60%", d: "The keeper adds margin from the vault's buffer, back to about 35%." },
  { tone: "danger" as const, k: "Buffer used up", v: "Margin use 60%+", d: "The plan shows how much USDC to deposit so the keeper can add it, or you can close the hedge." },
  { tone: "ink" as const, k: "Liquidation", v: "Margin use 100%", d: "Veranta closes the position. What's left stays in your vault." },
];

const VAULT_POINTS = [
  ["Your own contract", "Your wallet approves the USDC and creates the vault, owned by you. Nobody else can withdraw from it."],
  ["Limits on Base", "The vault itself caps leverage, hedge size, margin and slippage. Locke's keeper can open and add margin within them; it can never close your hedge or withdraw."],
  ["Exit from your wallet", "Withdraw or remove Locke's keeper at any time, even if Locke is offline, and close the hedge while its market is open."],
  ["Public proof", "While the hedge is open, a Protected by Locke attestation on Base shows it, so a lender or client can check it."],
  ["Protect as you get paid", "Optionally, sign once to move a share of incoming USDC into the vault, never more than your weekly cap."],
  ["One vault per plan", "Each hedge has its own vault and its own margin, so trouble in one never touches another."],
];

export default function HowItWorksPage() {
  return (
    <div className="animate-rise space-y-3">
      <section className="pb-10 pt-6 sm:pt-12">
        <Eyebrow className="mb-6 text-ink-2">How it works</Eyebrow>
        <Display size="xl" lead="Describe. Preview. Fund. Watch." rest="Every plan, the same four steps." className="max-w-[14ch]" />
        <p className="mt-6 max-w-[60ch] text-[15px] leading-relaxed text-ink-2">
          Locke runs on Base. Each plan is a vault you own, and Locke hedges from it on Veranta, within limits the vault itself enforces.
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

      <section className="grid grid-cols-1 gap-3 pt-12 md:grid-cols-2 xl:grid-cols-3">
        <Card tone="cobalt" id="holdings" className="scroll-mt-24">
          <Eyebrow className={SUBTLE.cobalt}>Holdings plan · ETH or BTC · protects against a fall</Eyebrow>
          <h2 className="display mt-7 text-[22px]">Protect what you hold</h2>
          <p className={`mt-4 text-[14px] leading-relaxed ${SUBTLE.cobalt}`}>
            Locke sells ETH or BTC on Veranta against the share of your treasury you choose to protect. If the price falls, the hedge gains
            what the treasury loses. It&apos;s a direct hedge: the only gaps are holding costs, fees and any share you leave unhedged. The coins
            you hold never move; only the USDC margin sits in the vault.
          </p>
        </Card>
        <Card tone="lime" id="costs" className="scroll-mt-24">
          <Eyebrow className={SUBTLE.lime}>Operating costs plan · WTI or Brent · protects against a rise</Eyebrow>
          <h2 className="display mt-7 text-[22px]">Manage what you buy</h2>
          <p className={`mt-4 text-[14px] leading-relaxed ${SUBTLE.lime}`}>
            Locke buys crude on Veranta for the part of your oil bill that moves with crude: all of it for crude oil itself, part of it for
            diesel, petrol, jet and marine fuel, heating oil, LPG, asphalt or plastics. If crude rises, the hedge gains and pays down the
            bill. For anything but crude it&apos;s a partial hedge: local prices also move with refining margins, exchange rates, taxes
            and policy, which crude doesn&apos;t capture.
          </p>
        </Card>
        <Card tone="ink" id="stocks" className="scroll-mt-24">
          <Eyebrow className={SUBTLE.ink}>Stocks plan · shares or an index · protects against a fall</Eyebrow>
          <h2 className="display mt-7 text-[22px]">Protect the stocks you hold</h2>
          <p className={`mt-4 text-[14px] leading-relaxed ${SUBTLE.ink}`}>
            Locke sells the stock (NVIDIA, Apple, Tesla and more) or an S&amp;P 500 or Nasdaq 100 index on Veranta against the share you choose
            to protect. If the shares fall, the hedge gains. Holding Coinbase&apos;s tokenized stocks on Base? Locke reads them from your
            account and sizes the plan for you. Stock markets follow US trading hours: these plans start with a bigger buffer, and the hedge can
            only be closed while the market is open. Stock plans aren&apos;t available to US persons.
          </p>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-3 pt-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Display as="h2" size="lg" lead="Margin kept topped up." rest="Before Veranta steps in." />
          <p className="mt-6 max-w-[44ch] text-[15px] leading-relaxed text-ink-2">
            Each vault keeps a buffer of USDC beside the hedge. Locke&apos;s keeper watches margin use around the clock and, while the market is
            open, adds from the buffer well before liquidation, only within the limits your vault sets. When the buffer runs out, your
            plan&apos;s page says how much to add.
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

      <Card tone="ink" as="section" id="vault" className="!mt-12 scroll-mt-24 px-6 py-10 sm:px-10">
        <Eyebrow className="text-lime">Your vault on Base</Eyebrow>
        <Display as="h2" size="lg" lead="A vault you own." rest="Locke hedges from it within limits you set." restClass="text-paper/55" className="mt-6 max-w-[22ch]" />
        <ul className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-[18px] bg-paper/10 sm:grid-cols-2 lg:grid-cols-3">
          {VAULT_POINTS.map(([t, d]) => (
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
