"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { runDeposit, StepTracker, type DepositStep } from "../DepositFlow";
import { Field, Slider } from "../form";
import { When } from "../Time";
import { Arrow, Button, Card, Display, ErrorNote, inputCls, LinkButton, MarginBar, Stat } from "../ui";
import { useWallet } from "../WalletProvider";
import { usePlan } from "./PlanProvider";
import type { CostsInputs, HoldingsInputs } from "@/lib/domain/types";
import { api, ApiError, errorMessage } from "@/lib/ui/api";
import { num, pct, signedUsd, usd } from "@/lib/ui/format";

function ActionLayout({ title, rest, intro, children }: { title: string; rest: string; intro: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <div className="lg:col-span-5">
        <Display as="h2" size="md" lead={title} rest={rest} />
        <div className="mt-6 max-w-[42ch] text-[14px] leading-relaxed text-ink-2">{intro}</div>
      </div>
      <Card className="lg:col-span-7">{children}</Card>
    </div>
  );
}

export function TopUpForm({ adaPrice }: { adaPrice: number | null }) {
  const { detail, refresh } = usePlan();
  const { ensureWallet, me } = useWallet();
  const plan = detail.plan;
  const [amount, setAmount] = useState(() => String(Math.max(6, Math.ceil(plan.suggestedTopUpUsd || 6))));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<DepositStep | null>(null);
  const [tx, setTx] = useState<string | undefined>();
  // A top-up on its way (on Cardano, or credited on Strike and not yet added to this plan's margin).
  const pending = detail.deposits.find((x) => x.purpose === "topup" && (x.status === "submitted" || x.status === "credited"));

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
        sessionAddress: me?.address ?? null,
        planId: plan.id,
        purpose: "topup",
        amountUsd: usdAmt,
        onStep: (s, info) => {
          setStep(s);
          if (info?.txHash) setTx(info.txHash);
        },
      });
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
      setStep(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ActionLayout
      title="Top up."
      rest="Add margin to this plan only."
      intro={
        <>
          <p>
            {plan.riskLevel === "ok"
              ? "Adding margin moves this plan further from liquidation."
              : `Liquidation is ${pct(plan.liquidationDistance, 1)} away. A top-up moves it back to a safe distance.`}
          </p>
          <p className="mt-4 text-[13px] text-ink-3">
            Each top-up converts a slice of ADA into a USD balance on Strike, which slightly lowers the ADA you have staked and voting.
            {plan.type === "holdings" && " Once it credits, consider resizing the plan to match the ADA you now hold."}
          </p>
        </>
      }
    >
      {step === "submitted" || pending ? (
        <div>
          <StepTracker step={pending?.status === "credited" ? "confirmed" : "submitted"} txHash={tx ?? pending?.tx_hash ?? undefined} />
          <p className="mt-5 text-[14px] leading-relaxed text-ink-2">
            {pending?.status === "credited"
              ? "Strike has credited the top-up. Locke is adding it to this plan's margin; a new top-up can start once that's done."
              : "Once Strike credits the deposit, Locke adds it to this plan's margin. Your other plans are untouched."}
          </p>
          <LinkButton href={`/plans/${plan.id}`} className="mt-6">
            Back to plan <Arrow />
          </LinkButton>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Amount in USD" hint={adaPrice && usdAmt ? `≈ ${num(usdAmt / adaPrice, 1)} ADA from your wallet. Minimum $6.` : "Minimum $6."}>
            <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <div className="space-y-4 py-2">
            <div>
              <div className="mb-2 text-[13px] text-ink-2">Margin health now</div>
              <MarginBar ratio={plan.ratio} watch={plan.thresholds.watch} action={plan.thresholds.action} />
            </div>
            <div>
              <div className="mb-2 text-[13px] text-ink-2">After this top-up</div>
              <MarginBar ratio={newRatio} watch={plan.thresholds.watch} action={plan.thresholds.action} />
            </div>
          </div>
          <ErrorNote error={error} />
          <Button size="lg" className="w-full justify-between" busy={busy} disabled={usdAmt < 6} onClick={submit}>
            Sign top-up of {usd(usdAmt, 0)} <Arrow />
          </Button>
        </div>
      )}
    </ActionLayout>
  );
}

export function ResizeForm() {
  const { detail, refresh } = usePlan();
  const router = useRouter();
  const plan = detail.plan;
  const isHoldings = plan.type === "holdings";
  const h = plan.inputs as HoldingsInputs;
  const c = plan.inputs as CostsInputs;
  const [share, setShare] = useState(isHoldings ? h.sharePct : 0);
  const [held, setHeld] = useState(isHoldings ? String(h.amountHeld) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [share, held]);

  const submit = async (body: object) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/plans/${plan.id}/resize`, { body });
      await refresh();
      router.push(`/plans/${plan.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
      // Too early for the next month (409): pick up when it's due.
      if (e instanceof ApiError && e.status === 409) void refresh();
    }
  };

  if (!isHoldings) {
    const dueAt = plan.nextMonthlyReduceAt ?? null;
    const early = dueAt != null && new Date(dueAt).getTime() > Date.now();
    return (
      <ActionLayout
        title="Resize."
        rest="Close the month you've used."
        intro={<p>Each month, close the part of the hedge that matched the fuel you burned. The rest keeps protecting the months ahead.</p>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 rounded-2xl bg-mist p-4">
            <Stat label="Close now" value={`${num((plan.position?.size ?? 0) / c.months, 2)} WTI`} />
            <Stat label="Months left" value={`${c.months} → ${Math.max(0, c.months - 1)}`} />
          </div>
          {dueAt && c.months > 1 && (
            <p className="text-[13px] text-ink-2">
              {early ? "The next month can be closed from " : "A month has been due since "}
              <When iso={dueAt} />.
            </p>
          )}
          <ErrorNote error={error} />
          {c.months <= 1 ? (
            <LinkButton href={`/plans/${plan.id}/close`} size="lg" variant="ink" className="w-full">
              Last month: close the plan instead <Arrow />
            </LinkButton>
          ) : (
            <Button size="lg" className="w-full justify-between" busy={busy} disabled={early} onClick={() => submit({ action: "month" })}>
              {early ? "Not due yet" : "Close one month on Strike"} <Arrow />
            </Button>
          )}
        </div>
      </ActionLayout>
    );
  }

  const target = Math.floor((Number(held) * share) / 100) || 0;
  return (
    <ActionLayout title="Resize." rest="Match the hedge to what you hold." intro={<p>Change how much ADA you hold or how much of it to protect. Locke adds to or reduces the hedge on Strike.</p>}>
      <div className="space-y-4">
        <Field label="ADA your business holds">
          <input className={inputCls} inputMode="numeric" value={held} onChange={(e) => setHeld(e.target.value)} />
        </Field>
        <Field label={<span className="flex justify-between">Share to protect <span className="num text-ink">{share}%</span></span>}>
          <Slider label="Share to protect" min={10} max={100} step={5} value={share} onChange={setShare} />
        </Field>
        <div className="grid grid-cols-2 gap-3 rounded-2xl bg-mist p-4">
          <Stat label="Hedge now" value={`${num(plan.position?.size, 0)} ADA`} />
          <Stat label="New hedge" value={`${num(target, 0)} ADA`} />
        </div>
        <ErrorNote error={error} />
        <Button size="lg" className="w-full justify-between" busy={busy} onClick={() => submit({ sharePct: share, amountHeld: Number(held) })}>
          Resize on Strike <Arrow />
        </Button>
      </div>
    </ActionLayout>
  );
}

export function CloseForm() {
  const { detail, refresh } = usePlan();
  const { refreshMe } = useWallet();
  const router = useRouter();
  const plan = detail.plan;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/plans/${plan.id}/close`, { body: {} });
      await refresh();
      void refreshMe();
      router.push(`/plans/${plan.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <ActionLayout
      title="Close this plan?"
      rest="The hedge ends at market."
      intro={
        <p>
          Locke sends a reduce-only order that closes the whole hedge. The plan&apos;s margin returns to your Strike balance, which you can
          withdraw to your wallet.
        </p>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 rounded-2xl bg-mist p-4">
          <Stat label="Hedge result" value={signedUsd(plan.position?.upnl)} />
          <Stat label="Funding to date" value={signedUsd(plan.position?.fundingToDate)} />
          <Stat label="Hedge size" value={`${num(plan.position?.size, 2)} ${plan.symbol.split("-")[0]}`} />
          <Stat label="Margin returned" value={usd((plan.position?.isoBalance ?? 0) + (plan.position?.upnl ?? 0))} sub="approximate, before fees" />
        </div>
        <ErrorNote error={error} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="ink" size="lg" className="flex-1" busy={busy} onClick={submit}>
            Close plan
          </Button>
          <LinkButton href={`/plans/${plan.id}`} variant="ghost" size="lg">
            Keep it open
          </LinkButton>
        </div>
      </div>
    </ActionLayout>
  );
}
