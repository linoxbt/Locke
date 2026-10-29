import type { Metadata } from "next";
import Link from "next/link";
import { BaseMark } from "@/components/base/BaseMark";
import { Card, Display, Eyebrow, Notice, Stat } from "@/components/ui";
import { proofPath } from "@/lib/base/attest";
import { readMetrics, type Metrics } from "@/lib/server/metrics";
import { usd } from "@/lib/ui/format";

// Read per request (a few aggregate queries), so a build never needs the database.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Metrics — Locke",
  description: "What Locke protects right now on Strike (Cardano) and Base, read from Locke's own records.",
};

const count = (n: number) => n.toLocaleString("en-US");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function MetricsPage() {
  let m: Metrics;
  try {
    m = await readMetrics();
  } catch {
    return <Notice tone="danger">Locke&apos;s metrics are unavailable right now. Try again shortly.</Notice>;
  }

  return (
    <div className="flex flex-col gap-6">
      <Display lead="Locke in numbers." rest="Read from Locke's own records on Strike and Base." />

      <Card tone="ink" className="flex flex-col gap-2 p-6 sm:p-8">
        <Eyebrow className="text-lime">Protected right now</Eyebrow>
        <div className="num display text-[44px] leading-none sm:text-[64px]">{usd(m.protectedUsd, 0)}</div>
        <p className="text-[14px] text-paper/60">
          Across {count(m.strike.activePlans + m.base.activeVaults)} open hedges: {count(m.strike.activePlans)} on Strike and {count(m.base.activeVaults)} on Base.
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex flex-col gap-5">
          <Eyebrow className="text-ink-2">On Cardano · with Strike</Eyebrow>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
            <Stat label="Protected now" value={usd(m.strike.protectedUsd, 0)} />
            <Stat label="Open plans" value={count(m.strike.activePlans)} />
            <Stat label="Plans hedged so far" value={count(m.strike.plansCreated)} />
          </div>
        </Card>
        <Card className="flex flex-col gap-5">
          <Eyebrow className="flex items-center gap-2 text-ink-2">
            <BaseMark size={12} /> On Base · with Avantis
          </Eyebrow>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
            <Stat label="Protected now" value={usd(m.base.protectedUsd, 0)} />
            <Stat label="Open vaults" value={count(m.base.activeVaults)} />
            <Stat label="Vaults created" value={count(m.base.vaultsCreated)} />
            <Stat label="Live proofs" value={count(m.base.liveProofs)} sub="Protected by Locke attestations" />
            <Stat label="Builder Code transactions" value={count(m.base.builderCodeTxs)} sub="Vault creations and keeper transactions" />
          </div>
        </Card>
      </div>

      <Card tone="mist" className="flex flex-col gap-4">
        <Eyebrow className="text-ink-2">Latest proofs on Base</Eyebrow>
        {m.proofs.length === 0 ? (
          <p className="text-[14px] text-ink-2">No live proofs yet. Each Base vault gets one when its hedge opens.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-[14px]">
            {m.proofs.map((p) => (
              <li key={p.uid} className="flex items-baseline justify-between gap-4 border-b border-line pb-2 last:border-0">
                <Link href={proofPath(p.uid)} className="underline-offset-4 hover:underline">
                  {usd(p.protectedUsd, 0)} on {p.market}
                </Link>
                <span className="num shrink-0 text-ink-3">{day(p.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-[13px] leading-relaxed text-ink-3">
        &quot;Protected now&quot; is the size of the hedges open at this moment, in US dollars. Strike plans count once their hedge has opened; Base vaults once created. Every
        Base proof can be checked independently on the Ethereum Attestation Service. Read {day(m.at)}.
      </p>
    </div>
  );
}
