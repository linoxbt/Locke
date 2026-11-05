import type { Metadata } from "next";
import { DropIn } from "@/components/DropIn";
import { PlanCard, type PlanRow } from "@/components/PlanCard";
import { Arrow, Card, Display, Eyebrow, LinkButton, Notice } from "@/components/ui";
import { baseClientSettings, requireBasePage } from "@/lib/server/basePages";
import { listVaults, recoverVaults } from "@/lib/server/baseVaults";
import { usd } from "@/lib/ui/format";

export const metadata: Metadata = { title: "Portfolio — Locke" };
export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const s = await requireBasePage("/portfolio");
  const { factory } = baseClientSettings();
  // A plan created on Base that this account's browser never got to save: record it now. Bounded,
  // so a slow Base read never holds the page up.
  await Promise.race([recoverVaults(s), new Promise((r) => setTimeout(r, 4_000))]);
  const plans = (await listVaults(s.uid)) as unknown as PlanRow[];

  const live = plans.filter((p) => p.status !== "closed");
  const closed = plans.filter((p) => p.status === "closed");
  const active = live.filter((p) => p.status === "active");
  const protectedUsd = active.reduce((sum, p) => sum + (p.sizing?.notionalUsd ?? 0), 0);
  const attention = active.filter((p) => (p.risk_level ?? "ok") !== "ok").length;

  return (
    <div className="animate-rise">
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <Eyebrow className="text-ink-2">Total value protected</Eyebrow>
          <div className="num mt-4 text-[32px] leading-none tracking-tight sm:text-[44px]">{usd(protectedUsd, 0)}</div>
          <p className="mt-4 text-[14px] text-ink-2">
            Hedge value across {active.length} active plan{active.length === 1 ? "" : "s"}, on Veranta.
            {attention > 0 && <span className="text-danger-ink"> {attention} need{attention === 1 ? "s" : ""} attention.</span>}
          </p>
        </div>
        <div className="flex flex-col gap-2 lg:col-span-4 lg:items-end lg:justify-end">
          <LinkButton href="/protect" size="lg" className="w-full justify-between gap-6 lg:w-auto">
            New protection plan <Arrow />
          </LinkButton>
        </div>
      </section>

      {!factory && (
        <div className="mt-6">
          <Notice tone="info">Locke isn&apos;t live yet. You can describe and preview a plan now; creating it opens at launch.</Notice>
        </div>
      )}

      {live.length === 0 && (
        <Card tone="ink" className="mt-7 px-6 py-16 text-center sm:py-24">
          <Display as="h2" size="lg" lead="Nothing protected yet." rest="Start with what keeps you up at night." restClass="text-paper/45" className="mx-auto max-w-[16ch]" />
          <LinkButton href="/protect" variant="paper" size="lg" className="mt-7">
            What do you want to protect? <Arrow />
          </LinkButton>
        </Card>
      )}

      {live.length > 0 && (
        <DropIn className="mt-7 grid grid-cols-1 gap-3 md:grid-cols-2">
          {live.map((p) => (
            <PlanCard key={p.address} p={p} />
          ))}
        </DropIn>
      )}

      {closed.length > 0 && (
        <section className="mt-14">
          <h2 className="display text-[18px]">Closed</h2>
          <DropIn className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {closed.map((p) => (
              <PlanCard key={p.address} p={p} />
            ))}
          </DropIn>
        </section>
      )}
    </div>
  );
}
