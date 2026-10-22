"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PlanCard } from "@/components/PlanCard";
import { Arrow, Button, Card, Display, ErrorNote, Eyebrow, Notice, Spinner } from "@/components/ui";
import { useWallet } from "@/components/WalletProvider";
import { WithdrawSheet } from "@/components/WithdrawSheet";
import type { PlanView } from "@/lib/server/planService";
import { api, errorMessage } from "@/lib/ui/api";
import { usd } from "@/lib/ui/format";

export default function PortfolioPage() {
  const { me, loading } = useWallet();
  const router = useRouter();
  const [plans, setPlans] = useState<PlanView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [withdraw, setWithdraw] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ plans: PlanView[]; liveError: string | null }>("/api/plans");
      setPlans(r.plans);
      setLiveError(r.liveError);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    if (!loading && !me) router.replace("/");
  }, [loading, me, router]);

  useEffect(() => {
    if (!me) return;
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [me, load]);

  if (!me) return null;
  const live = plans?.filter((p) => p.status !== "closed") ?? [];
  const closed = plans?.filter((p) => p.status === "closed") ?? [];
  const active = live.filter((p) => p.status === "active");
  const protectedUsd = active.reduce((sum, p) => sum + (p.position ? p.position.size * p.mark : 0), 0);
  const attention = active.filter((p) => p.riskLevel !== "ok").length;

  return (
    <div className="animate-rise">
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Eyebrow className="text-ink-2">Total value protected</Eyebrow>
          <div className="num mt-4 text-[64px] leading-none tracking-tight sm:text-[104px]">{usd(protectedUsd, 0)}</div>
          <p className="mt-4 text-[15px] text-ink-2">
            Hedge value across {active.length} active plan{active.length === 1 ? "" : "s"}, at Strike mark price.
            {attention > 0 && <span className="text-danger"> {attention} need{attention === 1 ? "s" : ""} attention.</span>}
          </p>
        </div>
        <div className="flex flex-col gap-2 lg:col-span-5 lg:items-end lg:justify-end">
          <Link href="/protect" className="w-full lg:w-auto">
            <Button size="lg" className="w-full justify-between gap-6">
              New protection plan <Arrow />
            </Button>
          </Link>
          {me.balance && me.balance.available >= 5 && (
            <Button variant="ghost" className="w-full lg:w-auto" onClick={() => setWithdraw(true)}>
              Withdraw {usd(me.balance.available)} free balance
            </Button>
          )}
        </div>
      </section>

      <div className="mt-8 space-y-2">
        <ErrorNote error={error} />
        {liveError && <Notice>Live numbers from Strike are unavailable right now ({liveError}). Showing stored plans.</Notice>}
      </div>

      {plans == null && !error && (
        <div className="mt-24 flex justify-center">
          <Spinner />
        </div>
      )}

      {plans && live.length === 0 && (
        <Card tone="ink" className="mt-10 px-6 py-16 text-center sm:py-24">
          <Display as="h2" size="lg" lead="Nothing protected yet." rest="Start with what keeps you up at night." restClass="text-paper/45" className="mx-auto max-w-[16ch]" />
          <Link href="/protect" className="mt-10 inline-block">
            <Button variant="paper" size="lg">
              What do you want to protect? <Arrow />
            </Button>
          </Link>
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
          <h2 className="display text-[28px]">Closed</h2>
          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {closed.map((p) => (
              <PlanCard key={p.id} p={p} />
            ))}
          </div>
        </section>
      )}

      {me.balance && <WithdrawSheet open={withdraw} onClose={() => setWithdraw(false)} available={me.balance.available} />}
    </div>
  );
}
