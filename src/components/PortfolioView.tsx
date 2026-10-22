"use client";

import { useCallback, useEffect, useState } from "react";
import { PlanCard } from "./PlanCard";
import { Arrow, Card, Display, ErrorNote, Eyebrow, LinkButton, Notice } from "./ui";
import type { PlanView } from "@/lib/server/planService";
import { api, errorMessage } from "@/lib/ui/api";
import { usd } from "@/lib/ui/format";

/** Portfolio body: server renders the first copy, this keeps it live. */
export function PortfolioView({ initial }: { initial: { plans: PlanView[]; liveError: string | null } }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<{ plans: PlanView[]; liveError: string | null }>("/api/plans"));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && load(), 10_000);
    return () => clearInterval(t);
  }, [load]);

  const live = data.plans.filter((p) => p.status !== "closed");
  const closed = data.plans.filter((p) => p.status === "closed");
  const active = live.filter((p) => p.status === "active");
  const protectedUsd = active.reduce((sum, p) => sum + (p.position ? p.position.size * p.mark : 0), 0);
  const attention = active.filter((p) => p.riskLevel !== "ok").length;

  return (
    <>
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <Eyebrow className="text-ink-2">Total value protected</Eyebrow>
          <div className="num mt-4 text-[44px] leading-none tracking-tight sm:text-[68px]">{usd(protectedUsd, 0)}</div>
          <p className="mt-4 text-[15px] text-ink-2">
            Hedge value across {active.length} active plan{active.length === 1 ? "" : "s"}, at Strike mark price.
            {attention > 0 && <span className="text-danger"> {attention} need{attention === 1 ? "s" : ""} attention.</span>}
          </p>
        </div>
        <div className="flex flex-col gap-2 lg:col-span-4 lg:items-end lg:justify-end">
          <LinkButton href="/protect" size="lg" className="w-full justify-between gap-6 lg:w-auto">
            New protection plan <Arrow />
          </LinkButton>
        </div>
      </section>

      <div className="mt-8 space-y-2">
        <ErrorNote error={error} />
        {data.liveError && <Notice>Live numbers from Strike are unavailable right now ({data.liveError}). Showing stored plans.</Notice>}
      </div>

      {live.length === 0 && (
        <Card tone="ink" className="mt-10 px-6 py-16 text-center sm:py-24">
          <Display as="h2" size="lg" lead="Nothing protected yet." rest="Start with what keeps you up at night." restClass="text-paper/45" className="mx-auto max-w-[16ch]" />
          <LinkButton href="/protect" variant="paper" size="lg" className="mt-10">
            What do you want to protect? <Arrow />
          </LinkButton>
        </Card>
      )}

      {live.length > 0 && (
        <div className="mt-10 grid grid-cols-1 gap-3 md:grid-cols-2">
          {live.map((p) => (
            <PlanCard key={p.id} p={p} />
          ))}
        </div>
      )}

      {closed.length > 0 && (
        <section className="mt-20">
          <h2 className="display text-[22px]">Closed</h2>
          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {closed.map((p) => (
              <PlanCard key={p.id} p={p} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
