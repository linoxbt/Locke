"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { runDeposit, StepTracker, type DepositStep } from "../DepositFlow";
import { Arrow, Button, Card, Display, ErrorNote, LinkButton, Stat } from "../ui";
import { useWallet } from "../WalletProvider";
import { usePlan } from "./PlanProvider";
import { api, errorMessage } from "@/lib/ui/api";
import { num, usd } from "@/lib/ui/format";

/** Fund a plan and follow it until the hedge is open on Strike. */
export function FundStep({ adaPrice }: { adaPrice: number | null }) {
  const { detail, refresh } = usePlan();
  const { ensureWallet, refreshMe } = useWallet();
  const router = useRouter();
  const p = detail.plan;
  const openDeposit = detail.deposits.find((x) => x.purpose === "open" && x.tx_hash);
  const inFlight = detail.deposits.some((x) => x.purpose === "open" && x.status === "submitted");
  const [step, setStep] = useState<DepositStep | null>(null);
  const [tx, setTx] = useState<string | undefined>(openDeposit?.tx_hash ?? undefined);
  const [skipDeposit, setSkipDeposit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Status from the server wins over local progress once it moves on.
  const shown: DepositStep | null =
    p.status === "active" ? "open" : p.status === "opening" ? "confirmed" : inFlight ? "submitted" : step;
  const canStart = (p.status === "draft" || p.status === "funding") && !inFlight && !busy && shown == null;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const w = await ensureWallet();
      const dep = await runDeposit({
        wallet: w,
        planId: p.id,
        purpose: "open",
        onStep: (s, info) => {
          setStep(s);
          if (info?.txHash) setTx(info.txHash);
        },
      });
      if (!dep) {
        setSkipDeposit(true);
        await api(`/api/plans/${p.id}/open`, { body: {} });
        setStep("confirmed");
      }
      const next = await refresh();
      if (next?.plan.status === "active") void refreshMe();
    } catch (e) {
      setError(errorMessage(e));
      setStep(null);
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    setBusy(true);
    try {
      await api(`/api/plans/${p.id}/close`, { body: {} });
      router.push("/portfolio");
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const s = detail.preview?.sizing ?? p.sizing;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <div className="lg:col-span-5">
        <Display
          as="h2"
          size="md"
          lead={shown === "open" ? "You're protected." : shown ? "Opening your plan." : "Fund this plan."}
          rest={shown === "open" ? "Locke is watching it." : shown ? "This takes a few minutes." : "One ADA deposit, signed in your wallet."}
        />
        <p className="mt-6 max-w-[40ch] text-[14px] leading-relaxed text-ink-2">
          {shown === "submitted"
            ? "Cardano needs a few confirmations before Strike credits the deposit. You can leave this page; Locke finishes opening the plan."
            : shown === "open"
              ? "The hedge is live on Strike with its own isolated margin."
              : shown
                ? "Keep your wallet open to sign."
                : "If your Strike balance already covers this plan, Locke skips the deposit and opens the hedge straight away."}
        </p>
        {p.statusNote && shown !== "open" && <p className="mt-4 text-[13px] text-ink-3">{p.statusNote}</p>}
        {!shown && (
          <Card className="mt-6">
            <div className="grid grid-cols-2 gap-6">
              <Stat label="Margin to deposit" value={usd(s.requiredUsd)} sub={adaPrice ? `≈ ${num(s.requiredUsd / adaPrice, 0)} ADA` : undefined} />
              <Stat label="Hedge" value={`${num(s.size, 2)} ${p.symbol.split("-")[0]}`} sub={`${s.side === "sell" ? "short" : "long"} · ${s.leverage}x`} />
            </div>
          </Card>
        )}
      </div>
      <Card tone="mist" className="lg:col-span-7">
        {shown ? (
          <StepTracker step={shown} txHash={tx} failed={!!error} skipDeposit={skipDeposit} />
        ) : (
          <p className="text-[14px] leading-relaxed text-ink-2">
            Your wallet will ask you to sign one transaction that sends ADA to Strike as margin for this plan. Nothing else leaves your wallet.
          </p>
        )}
        <div className="mt-6 space-y-3">
          <ErrorNote error={error} />
          <div className="flex flex-wrap gap-2">
            {canStart && (
              <Button size="lg" busy={busy} onClick={start} className="justify-between gap-6">
                Sign deposit and open <Arrow />
              </Button>
            )}
            {canStart && (
              <Button variant="ghost" size="lg" onClick={discard}>
                Discard plan
              </Button>
            )}
            {shown === "open" && (
              <LinkButton href={`/plans/${p.id}`} size="lg">
                Go to plan <Arrow />
              </LinkButton>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
