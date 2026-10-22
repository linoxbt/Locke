"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PlanCard } from "@/components/PlanCard";
import { Button, ErrorNote, Spinner } from "@/components/ui";
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
  const protectedUsd = live
    .filter((p) => p.status === "active")
    .reduce((sum, p) => sum + (p.position ? p.position.size * p.mark : 0), 0);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted">Total value protected</div>
          <div className="num mt-1 text-4xl font-semibold">{usd(protectedUsd, 0)}</div>
          <div className="mt-1 text-xs text-faint">Hedge notional across active plans, at mark</div>
        </div>
        <div className="flex gap-2">
          {me.balance && me.balance.available >= 5 && (
            <Button variant="ghost" onClick={() => setWithdraw(true)}>
              Withdraw {usd(me.balance.available)}
            </Button>
          )}
          <Link href="/protect">
            <Button>New protection plan</Button>
          </Link>
        </div>
      </div>

      <div className="mt-6">
        <ErrorNote error={error} />
        {liveError && <p className="text-xs text-watch">Live numbers unavailable right now ({liveError}). Showing stored plans.</p>}
      </div>

      {plans == null && !error && (
        <div className="mt-16 flex justify-center">
          <Spinner />
        </div>
      )}

      {plans && live.length === 0 && (
        <div className="bracket mt-8 p-8 text-center">
          <p className="text-lg">No protection plans yet.</p>
          <p className="mt-1 text-sm text-muted">Protect the ADA your business holds, or the fuel it needs to buy.</p>
          <Link href="/protect" className="mt-5 inline-block">
            <Button>What do you want to protect?</Button>
          </Link>
        </div>
      )}

      {live.length > 0 && (
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {live.map((p) => (
            <PlanCard key={p.id} p={p} />
          ))}
        </div>
      )}

      {closed.length > 0 && (
        <>
          <h2 className="mt-12 text-xs uppercase tracking-wider text-muted">Closed</h2>
          <div className="mt-3 grid gap-4 opacity-70 md:grid-cols-2">
            {closed.map((p) => (
              <PlanCard key={p.id} p={p} />
            ))}
          </div>
        </>
      )}

      {me.balance && <WithdrawSheet open={withdraw} onClose={() => setWithdraw(false)} available={me.balance.available} />}
    </div>
  );
}
