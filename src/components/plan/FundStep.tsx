"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { runDeposit, StepTracker, type DepositStep } from "../DepositFlow";
import { Arrow, Button, Card, Display, ErrorNote, LinkButton, Notice, Stat } from "../ui";
import { useWallet } from "../WalletProvider";
import { usePlan } from "./PlanProvider";
import { PricingUnavailable, RiskCheckbox, RiskList } from "./PreviewStep";
import { api, errorMessage } from "@/lib/ui/api";
import { CARDANOSCAN, num, shortAddr, usd } from "@/lib/ui/format";

/** Mirrors the cushion the server adds to the margin before it skips the deposit. */
const COVER_CUSHION = 1.03;

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={spinning ? "animate-spin" : ""}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 4v5h-5" />
    </svg>
  );
}

/** Fund a plan and follow it until the hedge is open on Strike. */
export function FundStep({ adaPrice }: { adaPrice: number | null }) {
  const { detail, refresh } = usePlan();
  const { ensureWallet, refreshMe, me } = useWallet();
  const router = useRouter();
  const p = detail.plan;
  const openDeposit = detail.deposits.find((x) => x.purpose === "open" && x.tx_hash);
  const inFlight = detail.deposits.some((x) => x.purpose === "open" && x.status === "submitted");
  const [step, setStep] = useState<DepositStep | null>(null);
  const [tx, setTx] = useState<string | undefined>(openDeposit?.tx_hash ?? undefined);
  const [skipDeposit, setSkipDeposit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(p.riskAcknowledged);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  // The plan re-checks itself every few seconds; every fresh read counts as a check.
  useEffect(() => setCheckedAt(Date.now()), [detail]);
  // Deposits are listed newest first: the latest opening deposit failing means the user has to start again.
  const lastOpen = detail.deposits.find((x) => x.purpose === "open");
  const lastFailed = lastOpen?.status === "failed" ? lastOpen : null;
  const credited = detail.deposits.some((x) => x.purpose === "open" && x.status === "credited");

  // Local progress only bridges the moments the server can't know about: while this tab is
  // running the flow, and a submitted hash that hasn't reached the server yet. Otherwise the
  // server's state wins, so a deposit that failed later never leaves the page stuck on "Submitted".
  const hashUndelivered = step === "submitted" && !!tx && !detail.deposits.some((x) => x.tx_hash === tx);
  const local = busy || hashUndelivered ? step : null;
  const shown: DepositStep | null =
    p.status === "active" ? "open" : p.status === "opening" ? "confirmed" : inFlight ? "submitted" : local;
  const canStart = (p.status === "draft" || p.status === "funding") && !inFlight && !busy && shown == null;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!p.riskAcknowledged) await api(`/api/plans/${p.id}/ack`, { body: {} });
      const w = await ensureWallet();
      const dep = await runDeposit({
        wallet: w,
        sessionAddress: me?.address ?? null,
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
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
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

  const checkNow = async () => {
    setChecking(true);
    await refresh();
    setCheckedAt(Date.now());
    setChecking(false);
  };

  const retryPricing = async () => {
    setRetrying(true);
    await refresh({ preview: true });
    setRetrying(false);
  };

  const s = detail.preview?.sizing ?? p.sizing;
  // Known once Strike's balance has been read (or a run found no deposit needed): no signature then.
  const covered = skipDeposit || (me?.balance != null && me.balance.available >= s.requiredUsd * COVER_CUSHION);
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <div className="lg:col-span-5">
        <Display
          as="h2"
          size="md"
          lead={shown === "open" ? "You're protected." : shown ? "Opening your plan." : "Fund this plan."}
          rest={
            shown === "open"
              ? "Locke is watching it."
              : shown
                ? "This takes a few minutes."
                : covered
                  ? "Your Strike balance covers it."
                  : "One ADA deposit, signed in your wallet."
          }
        />
        <p className="mt-6 max-w-[40ch] text-[14px] leading-relaxed text-ink-2">
          {shown === "submitted"
            ? "Cardano needs a few confirmations before Strike credits the deposit. You can leave this page; Locke finishes opening the plan."
            : shown === "open"
              ? "The hedge is live on Strike with its own isolated margin."
              : shown
                ? "Keep your wallet open to sign."
                : covered
                  ? "Locke opens the hedge from your Strike balance. Nothing to sign and nothing leaves your wallet."
                  : "If your Strike balance already covers this plan, Locke skips the deposit and opens the hedge straight away."}
        </p>
        {p.statusNote && shown !== "open" && <p className="mt-4 text-[13px] text-ink-3">{p.statusNote}</p>}
        {!shown && (
          <Card className="mt-6">
            <div className="grid grid-cols-2 gap-6">
              <Stat
                label={covered ? "Margin from your balance" : "Margin to deposit"}
                value={usd(s.requiredUsd)}
                sub={adaPrice && !covered ? `≈ ${num(s.requiredUsd / adaPrice, 0)} ADA` : undefined}
              />
              <Stat
                label="Hedge"
                value={`${num(s.size, 2)} ${p.symbol.split("-")[0]}`}
                sub={`protects against a ${s.side === "sell" ? "fall" : "rise"} · ${s.leverage}x`}
              />
            </div>
          </Card>
        )}
      </div>
      <Card tone="mist" className="lg:col-span-7">
        {shown ? (
          <>
            <StepTracker step={shown} txHash={tx} orderId={p.openOrderId} failed={!!error} skipDeposit={skipDeposit} />
            {shown !== "open" && !busy && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button variant="ghost" disabled={checking} aria-busy={checking || undefined} onClick={checkNow}>
                  <RefreshIcon spinning={checking} /> Check status
                </Button>
                <span className="text-[12px] text-ink-3">
                  Updates by itself every few seconds
                  {checkedAt && ` · checked ${new Date(checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-4">
            {!detail.preview && detail.previewError && <PricingUnavailable error={detail.previewError} busy={retrying} onRetry={retryPricing} />}
            {lastFailed && (
              <Notice tone="danger">
                The last deposit wasn&apos;t credited by Strike, so the plan didn&apos;t open. If ADA left your wallet, check the transaction
                below; otherwise just sign again.
              </Notice>
            )}
            <p className="text-[14px] leading-relaxed text-ink-2">
              {covered
                ? "Locke places the hedge with margin from your Strike balance. Your wallet isn't asked to sign anything."
                : "Your wallet will ask you to sign one transaction that sends ADA to Strike as margin for this plan. Nothing else leaves your wallet."}
            </p>
            {!p.riskAcknowledged && canStart && (
              <div className="space-y-4 rounded-2xl bg-paper p-4">
                <RiskList type={p.type} />
                <RiskCheckbox checked={accepted} onChange={setAccepted} />
              </div>
            )}
          </div>
        )}
        {!shown && lastFailed?.tx_hash && (
          <a className="num mt-4 inline-flex rounded-full bg-paper px-4 py-2 text-[13px] text-cobalt" href={`${CARDANOSCAN}${lastFailed.tx_hash}`} target="_blank" rel="noreferrer">
            View the last transaction {shortAddr(lastFailed.tx_hash)} ↗
          </a>
        )}
        <div className="mt-6 space-y-3">
          <ErrorNote error={error} />
          {confirmDiscard && canStart && (
            <p role="alert" className="text-[13px] text-ink-2">
              Discard this plan?{" "}
              {credited
                ? "Its deposit stays on your Strike balance, where you can withdraw it."
                : lastFailed
                  ? "A deposit for it didn't complete: if ADA left your wallet, check the transaction above before you go."
                  : "Nothing has been deposited for it yet."}{" "}
              Press Discard again to confirm.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {canStart && (
              <Button size="lg" busy={busy} disabled={!accepted} onClick={start} className="justify-between gap-6">
                {covered ? "Open the hedge" : "Sign deposit and open"} <Arrow />
              </Button>
            )}
            {canStart && (
              <Button variant={confirmDiscard ? "danger" : "ghost"} size="lg" disabled={busy} onClick={discard}>
                {confirmDiscard ? "Discard" : "Discard plan"}
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
