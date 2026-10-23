"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PreviewCard } from "../PreviewCard";
import { Arrow, Button, Card, ErrorNote, LinkButton, Spinner } from "../ui";
import { usePlan } from "./PlanProvider";
import type { PlanType } from "@/lib/domain/types";
import { api, errorMessage } from "@/lib/ui/api";

/** The disclosures a user accepts before funding. The server records the acceptance and refuses deposits without it. */
export function RiskList({ type, className = "" }: { type: PlanType; className?: string }) {
  return (
    <ul className={`space-y-3 text-[14px] leading-relaxed text-ink-2 ${className}`}>
      <li>Locke is a tool, not financial advice; you decide what to protect.</li>
      <li>Hedges can lose money on their own: a holdings hedge gives up upside, a fuel hedge loses if fuel prices fall.</li>
      {type === "costs" && <li>The fuel plan is partial: local prices also move with exchange rates, taxes and policy.</li>}
      <li>Positions can be liquidated if margin runs out. Locke alerts you first, but can&apos;t top up without your signature.</li>
      <li>The deposit converts ADA to a USD balance on Strike, which slightly lowers the ADA you have staked.</li>
      <li>Strike has eligibility rules; check that you&apos;re allowed to use it before you fund a plan.</li>
    </ul>
  );
}

export function RiskCheckbox({ checked, onChange }: { checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-[14px]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-cobalt)]"
      />
      I understand the risks above and want Locke to open this hedge.
    </label>
  );
}

export function PreviewStep({ adaPrice }: { adaPrice: number | null }) {
  const { detail, refresh } = usePlan();
  const router = useRouter();
  const p = detail.plan;
  const [accepted, setAccepted] = useState(p.riskAcknowledged);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!detail.preview) {
    // The plan moved past the preview (funded or opened elsewhere): nothing to price any more.
    if (p.status !== "draft" && p.status !== "funding") {
      return (
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-[14px] text-ink-2">This plan has moved on from the preview.</p>
          <LinkButton href={`/plans/${p.id}`}>
            Go to plan <Arrow />
          </LinkButton>
        </Card>
      );
    }
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );
  }

  const proceed = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!p.riskAcknowledged) {
        await api(`/api/plans/${p.id}/ack`, { body: {} });
        // The plan layout (and its state) survives the navigation: pick up the acknowledgement first.
        await refresh();
      }
      router.push(`/plans/${p.id}/fund`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <PreviewCard type={p.type} inputs={p.inputs} preview={detail.preview} adaPrice={adaPrice} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Card tone="mist" className="lg:col-span-8">
          <h2 className="display text-[17px]">Before you open a plan</h2>
          <RiskList type={p.type} className="mt-5" />
        </Card>
        <Card className="flex flex-col lg:col-span-4">
          <RiskCheckbox checked={accepted} onChange={setAccepted} />
          <div className="mt-auto space-y-3 pt-8">
            <ErrorNote error={error} />
            <Button size="lg" className="w-full justify-between" disabled={!accepted} busy={busy} onClick={proceed}>
              Continue to funding <Arrow />
            </Button>
          </div>
        </Card>
      </div>
      <div className="flex flex-wrap gap-2 pt-2">
        <LinkButton href={`/protect/${p.type}`} variant="ghost">
          Start over with different numbers
        </LinkButton>
      </div>
    </div>
  );
}
