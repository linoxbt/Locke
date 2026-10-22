"use client";

import { useState } from "react";
import type { CostsInputs } from "@/lib/domain/types";
import { api, errorMessage } from "@/lib/ui/api";
import { runDeposit, StepTracker, type DepositStep } from "../DepositFlow";
import { PreviewCard } from "../PreviewCard";
import { ReplayPanel } from "../ReplayPanel";
import { Arrow, Button, Card, ErrorNote, Notice } from "../ui";
import { useWallet } from "../WalletProvider";
import type { PlanDetail } from "./types";

/** A plan that isn't open yet: resume funding, or follow it while Strike catches up. */
export function PendingPlan({ d, adaPrice, onChange }: { d: PlanDetail; adaPrice: number | null; onChange(): Promise<void> }) {
  const p = d.plan;
  const { ensureWallet } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<DepositStep>(p.status === "opening" ? "confirmed" : "submitted");
  const [tx, setTx] = useState<string | undefined>(d.deposits.find((x) => x.purpose === "open" && x.tx_hash)?.tx_hash ?? undefined);

  const fund = async () => {
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
      if (!dep) await api(`/api/plans/${p.id}/open`, { body: {} });
      await onChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    setBusy(true);
    try {
      await api(`/api/plans/${p.id}/close`, { body: {} });
      await onChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const waitingOnChain = p.status === "funding" && d.deposits.some((x) => x.purpose === "open" && x.status === "submitted");
  if (p.status === "opening" || waitingOnChain) {
    return (
      <Card tone="mist" className="mt-10">
        <StepTracker step={p.status === "opening" ? "confirmed" : step} txHash={tx} />
        <p className="mt-5 text-[14px] text-ink-2">{p.statusNote ?? "Waiting on Strike…"}</p>
      </Card>
    );
  }

  return (
    <div className="mt-10 space-y-3">
      {p.statusNote && <Notice tone="info">{p.statusNote}</Notice>}
      {d.preview && <PreviewCard type={p.type} inputs={p.inputs} preview={d.preview} adaPrice={adaPrice} />}
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <ErrorNote error={error} />
        </div>
        <Button variant="ghost" disabled={busy} onClick={discard}>
          Discard
        </Button>
        <Button size="lg" busy={busy} onClick={fund} className="justify-between gap-6">
          Fund and open <Arrow />
        </Button>
      </Card>
      <Card tone="ink">
        <ReplayPanel
          planId={p.id}
          type={p.type}
          currency={p.type === "costs" ? (p.inputs as CostsInputs).currency : "USD"}
          litres={p.type === "costs" ? (p.inputs as CostsInputs).litresPerMonth : 1}
        />
      </Card>
    </div>
  );
}
