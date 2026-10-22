"use client";

import { useState } from "react";
import { PreviewCard } from "../PreviewCard";
import { Arrow, Card, LinkButton, Spinner } from "../ui";
import { usePlan } from "./PlanProvider";

export function PreviewStep({ adaPrice }: { adaPrice: number | null }) {
  const { detail } = usePlan();
  const p = detail.plan;
  const [accepted, setAccepted] = useState(false);
  if (!detail.preview) {
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <PreviewCard type={p.type} inputs={p.inputs} preview={detail.preview} adaPrice={adaPrice} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Card tone="mist" className="lg:col-span-8">
          <h2 className="display text-[24px]">Before you open a plan</h2>
          <ul className="mt-5 space-y-3 text-[15px] leading-relaxed text-ink-2">
            <li>Locke is a tool, not financial advice; you decide what to protect.</li>
            <li>Hedges can lose money on their own: a holdings hedge gives up upside, a fuel hedge loses if fuel prices fall.</li>
            {p.type === "costs" && <li>The fuel plan is partial: local prices also move with exchange rates, taxes and policy.</li>}
            <li>Positions can be liquidated if margin runs out. Locke alerts you first, but can&apos;t top up without your signature.</li>
            <li>The deposit converts ADA to a USD balance on Strike, which slightly lowers the ADA you have staked.</li>
            <li>
              Strike has eligibility rules; check{" "}
              <a className="text-ink underline underline-offset-4" href="https://docs.strikefinance.org" target="_blank" rel="noreferrer">
                Strike&apos;s restricted persons policy
              </a>
              .
            </li>
          </ul>
        </Card>
        <Card className="flex flex-col lg:col-span-4">
          <label className="flex cursor-pointer items-start gap-3 text-[15px]">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-cobalt)]" />
            I understand the risks above and want Locke to open this hedge.
          </label>
          <div className="mt-auto pt-8">
            {accepted ? (
              <LinkButton href={`/plans/${p.id}/fund`} size="lg" className="w-full justify-between">
                Continue to funding <Arrow />
              </LinkButton>
            ) : (
              <span aria-disabled className="flex h-16 w-full items-center justify-between rounded-full bg-mist px-8 text-lg text-ink-3">
                Continue to funding <Arrow />
              </span>
            )}
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
