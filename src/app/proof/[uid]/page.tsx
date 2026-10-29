import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BaseMark } from "@/components/base/BaseMark";
import { Card, Display, Eyebrow, Notice, Stat } from "@/components/ui";
import { easscanUrl } from "@/lib/base/attest";
import { readProof, type ProofStatus } from "@/lib/server/baseProof";
import { shortAddr, usd } from "@/lib/ui/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Protected by Locke",
  description: "A public, on-chain proof that a business's holdings or fuel budget are protected by a Locke hedge on Base.",
};

const HEADLINE: Record<ProofStatus, { lead: string; rest: string; chip: string; cls: string }> = {
  protected: { lead: "Protected by Locke.", rest: "This hedge is open on Base right now.", chip: "Protected", cls: "bg-ok/15 text-ok" },
  ended: { lead: "Protection ended.", rest: "This vault has closed, so Locke revoked its proof.", chip: "Ended", cls: "bg-mist text-ink-2" },
  unverified: { lead: "Not issued by Locke.", rest: "This attestation uses Locke's format, but Locke's keeper didn't sign it.", chip: "Unverified", cls: "bg-danger/10 text-danger-ink" },
  other: { lead: "Not a Locke proof.", rest: "This attestation exists on Base, but it isn't a Protected by Locke record.", chip: "Not Locke", cls: "bg-danger/10 text-danger-ink" },
};

const day = (s: number) => new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default async function ProofPage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  let proof;
  try {
    proof = await readProof(uid);
  } catch {
    return (
      <Notice tone="danger">
        Locke couldn&apos;t reach Base to read this proof. Try again shortly, or check it on{" "}
        <a href={easscanUrl(uid)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          EAS Scan
        </a>
        .
      </Notice>
    );
  }
  if (!proof) notFound();
  const h = HEADLINE[proof.status];
  const p = proof.protection;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Eyebrow className="flex items-center gap-2 text-ink-2">
          <BaseMark size={12} /> Attestation on Base
        </Eyebrow>
        <span className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium ${h.cls}`}>
          {proof.status === "protected" && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
          {h.chip}
        </span>
      </div>
      <Display lead={h.lead} rest={h.rest} />

      {p && proof.status !== "other" && (
        <Card className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat label="Amount protected" value={usd(p.protectedUsd)} />
          <Stat label="Market" value={p.market} sub={p.long ? "Long: holds a cost down" : "Short: holds a value up"} />
          <Stat label="Since" value={day(p.startedAt)} />
          <Stat label={proof.endedAt ? "Ended" : "Status"} value={proof.endedAt ? day(proof.endedAt) : "Open"} />
        </Card>
      )}

      <Card tone="mist" className="flex flex-col gap-3 text-[14px]">
        <Row label="Protected business" value={shortAddr(proof.owner)} href={`https://basescan.org/address/${proof.owner}`} />
        {p && <Row label="Vault" value={shortAddr(p.vault)} href={`https://basescan.org/address/${p.vault}`} />}
        <Row label="Issued by" value={proof.status === "protected" || proof.status === "ended" ? `Locke's keeper (${shortAddr(proof.attester)})` : shortAddr(proof.attester)} href={`https://basescan.org/address/${proof.attester}`} />
        <Row label="Issued" value={day(proof.issuedAt)} />
        <Row label="Attestation" value={`${proof.uid.slice(0, 10)}…${proof.uid.slice(-6)}`} href={easscanUrl(proof.uid)} />
      </Card>

      <p className="text-[13px] leading-relaxed text-ink-3">
        This page reads the attestation straight from the Ethereum Attestation Service on Base. Locke&apos;s keeper issues it when a vault&apos;s
        hedge opens and revokes it when the vault closes, so it can&apos;t claim protection that has ended. A hedge limits how much a price move
        costs; it is not insurance.
      </p>
    </div>
  );
}

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3 last:border-0 last:pb-0">
      <span className="shrink-0 text-ink-2">{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="num text-right text-ink underline-offset-4 hover:underline">
          {value}
        </a>
      ) : (
        <span className="num text-right text-ink">{value}</span>
      )}
    </div>
  );
}
