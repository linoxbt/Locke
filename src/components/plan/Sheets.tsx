"use client";

import { useEffect, useState } from "react";
import type { CostsInputs, HoldingsInputs } from "@/lib/domain/types";
import type { PlanView } from "@/lib/server/planService";
import { api, errorMessage } from "@/lib/ui/api";
import { num, pct, signedUsd } from "@/lib/ui/format";
import { runDeposit, StepTracker, type DepositStep } from "../DepositFlow";
import { Button, ErrorNote, Field, inputCls, Sheet, Slider, Stat } from "../ui";
import { useWallet } from "../WalletProvider";

export function TopUpSheet({
  open,
  onClose,
  plan,
  adaPrice,
  onDone,
}: {
  open: boolean;
  onClose(): void;
  plan: PlanView;
  adaPrice: number | null;
  onDone(): Promise<void>;
}) {
  const { ensureWallet } = useWallet();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<DepositStep | null>(null);
  const [tx, setTx] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    setAmount(String(Math.max(6, Math.ceil(plan.suggestedTopUpUsd || 6))));
    setStep(null);
    setError(null);
    setTx(undefined);
  }, [open, plan.suggestedTopUpUsd]);

  const usdAmt = Number(amount) || 0;
  const pos = plan.position;
  const newRatio = pos ? pos.maintenanceMargin / (pos.isoBalance + pos.upnl + usdAmt) : null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const w = await ensureWallet();
      await runDeposit({
        wallet: w,
        planId: plan.id,
        purpose: "topup",
        amountUsd: usdAmt,
        onStep: (s, info) => {
          setStep(s);
          if (info?.txHash) setTx(info.txHash);
        },
      });
      await onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Top up this plan">
      {step === "submitted" ? (
        <div>
          <StepTracker step="submitted" txHash={tx} />
          <p className="mt-5 text-[15px] leading-relaxed text-ink-2">
            Once Strike credits the deposit, Locke adds it to this plan&apos;s margin only. Your other plans are untouched.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-[15px] leading-relaxed text-ink-2">
            {plan.riskLevel === "ok"
              ? "Adding margin moves this plan further from liquidation."
              : `Liquidation is ${pct(plan.liquidationDistance, 1)} away. A top-up moves it back to a safe distance.`}
          </p>
          <Field label="Amount in USD" hint={adaPrice && usdAmt ? `≈ ${num(usdAmt / adaPrice, 1)} ADA from your wallet` : undefined}>
            <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3 rounded-2xl bg-mist p-4">
            <Stat label="Margin ratio now" value={pct(plan.ratio, 2)} />
            <Stat label="After top-up" value={pct(newRatio, 2)} tone="ok" />
          </div>
          <p className="text-[13px] leading-relaxed text-ink-3">
            Each top-up converts a slice of ADA into a USD balance on Strike, which slightly lowers the ADA you have staked and voting.
            {plan.type === "holdings" && " Once it credits, consider resizing the plan to match the ADA you now hold."}
          </p>
          <ErrorNote error={error} />
          <Button size="lg" className="w-full" busy={busy} disabled={usdAmt < 6} onClick={submit}>
            Sign top-up
          </Button>
        </div>
      )}
    </Sheet>
  );
}

export function ResizeSheet({ open, onClose, plan, onDone }: { open: boolean; onClose(): void; plan: PlanView; onDone(): Promise<void> }) {
  const isHoldings = plan.type === "holdings";
  const h = plan.inputs as HoldingsInputs;
  const c = plan.inputs as CostsInputs;
  const [share, setShare] = useState(isHoldings ? h.sharePct : 0);
  const [held, setHeld] = useState(isHoldings ? String(h.amountHeld) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && isHoldings) {
      setShare(h.sharePct);
      setHeld(String(h.amountHeld));
    }
    setError(null);
  }, [open, isHoldings, h.sharePct, h.amountHeld]);

  const submit = async (body: object) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/plans/${plan.id}/resize`, { body });
      await onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Resize the hedge">
      {isHoldings ? (
        <div className="space-y-6">
          <Field label="ADA your business holds">
            <input className={inputCls} inputMode="numeric" value={held} onChange={(e) => setHeld(e.target.value)} />
          </Field>
          <Field
            label={<span className="flex justify-between">Share to protect <span className="num text-ink">{share}%</span></span>}
            hint={`New hedge ≈ ${num(Math.floor((Number(held) * share) / 100), 0)} ADA (now ${num(plan.position?.size, 0)})`}
          >
            <Slider label="Share to protect" min={10} max={100} step={5} value={share} onChange={setShare} />
          </Field>
          <ErrorNote error={error} />
          <Button size="lg" className="w-full" busy={busy} onClick={() => submit({ sharePct: share, amountHeld: Number(held) })}>
            Resize on Strike
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-[15px] leading-relaxed text-ink-2">
            Each month, close the part of the hedge that matched the fuel you&apos;ve used: {num((plan.position?.size ?? 0) / c.months, 2)} of{" "}
            {num(plan.position?.size, 2)} WTI, with {c.months} month{c.months === 1 ? "" : "s"} left.
          </p>
          <ErrorNote error={error} />
          <Button size="lg" className="w-full" busy={busy} disabled={c.months <= 1} onClick={() => submit({ action: "month" })}>
            Close one month
          </Button>
        </div>
      )}
    </Sheet>
  );
}

export function CloseSheet({ open, onClose, plan, onDone }: { open: boolean; onClose(): void; plan: PlanView; onDone(): Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="Close this plan?">
      <div className="space-y-5">
        <p className="text-[15px] leading-relaxed text-ink-2">
          Locke sends a reduce-only order that closes the whole hedge at market. The plan&apos;s margin returns to your Strike balance, which you
          can withdraw to your wallet.
        </p>
        <div className="grid grid-cols-2 gap-3 rounded-2xl bg-mist p-4">
          <Stat label="Hedge result" value={signedUsd(plan.position?.upnl)} />
          <Stat label="Funding to date" value={signedUsd(plan.position?.fundingToDate)} />
        </div>
        <ErrorNote error={error} />
        <Button
          variant="ink"
          size="lg"
          className="w-full"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api(`/api/plans/${plan.id}/close`, { body: {} });
              await onDone();
              onClose();
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Close plan
        </Button>
      </div>
    </Sheet>
  );
}
