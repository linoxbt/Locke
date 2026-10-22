"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { runDeposit, StepTracker, type DepositStep } from "@/components/DepositFlow";
import { LineChart } from "@/components/LineChart";
import { headlineText } from "@/components/PlanCard";
import { PreviewCard } from "@/components/PreviewCard";
import { ReplayPanel } from "@/components/ReplayPanel";
import { Button, ErrorNote, Field, inputCls, MarginBar, Sheet, Spinner, Stat, StateChip } from "@/components/ui";
import { useWallet } from "@/components/WalletProvider";
import type { CostsInputs, HoldingsInputs, Preview } from "@/lib/domain/types";
import type { PlanView } from "@/lib/server/planService";
import { api, errorMessage } from "@/lib/ui/api";
import { ago, CARDANOSCAN, local, num, pct, price, shortAddr, signedUsd, usd } from "@/lib/ui/format";
import type { DepositRow, PlanEvent, Snapshot } from "@/lib/ui/types";

interface Detail {
  plan: PlanView;
  preview: Preview | null;
  events: PlanEvent[];
  snapshots: Snapshot[];
  deposits: DepositRow[];
  liveError: string | null;
}

const WAITING = new Set(["funding", "opening", "closing"]);

export default function PlanPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { me, loading, ensureWallet, refreshMe } = useWallet();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | "topup" | "resize" | "close">(null);
  const [showReplay, setShowReplay] = useState(false);
  const [adaPrice, setAdaPrice] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const pending = d && (WAITING.has(d.plan.status) || d.deposits.some((x) => x.status === "submitted" || x.status === "credited"));
      if (pending) await api(`/api/plans/${id}/sync`, { body: {} }).catch(() => {});
      const r = await api<Detail>(`/api/plans/${id}`);
      setD(r);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id, d]);

  useEffect(() => {
    if (!loading && !me) router.replace("/");
  }, [loading, me, router]);

  useEffect(() => {
    if (!me) return;
    void load();
  }, [me, id]);

  useEffect(() => {
    if (!me || !d) return;
    const t = setTimeout(load, WAITING.has(d.plan.status) ? 5000 : 8000);
    return () => clearTimeout(t);
  }, [me, d, load]);

  useEffect(() => {
    api<{ ada: { mark: number } }>("/api/market").then((m) => setAdaPrice(m.ada.mark)).catch(() => {});
  }, []);

  if (!me) return null;
  if (!d) {
    return (
      <div className="mt-16 flex flex-col items-center gap-3">
        {error ? <ErrorNote error={error} /> : <Spinner />}
        <Link href="/portfolio" className="text-sm text-muted">← Portfolio</Link>
      </div>
    );
  }

  const p = d.plan;
  const h = headlineText(p);
  const cur = p.type === "costs" ? (p.inputs as CostsInputs).currency : "USD";
  const urgent = p.status === "active" && p.riskLevel !== "ok" && p.riskLevel !== "watch";
  const chartSeries =
    d.snapshots.length >= 2
      ? [
          {
            label: h.caption,
            color: "var(--color-accent)",
            values: d.snapshots.map((s) => Number(s.headline ?? NaN)),
          },
        ]
      : [];

  return (
    <div>
      <Link href="/portfolio" className="text-sm text-muted hover:text-text">
        ← Portfolio
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="num text-[11px] uppercase tracking-wider text-muted">{p.type === "holdings" ? "Holdings plan" : "Operating costs plan"}</div>
          <h1 className="text-2xl font-semibold">{p.name}</h1>
          <div className="num mt-1 text-xs text-accent">{p.label}</div>
        </div>
        <StateChip status={p.status} level={p.riskLevel} />
      </div>

      {d.liveError && (
        <p className="mt-3 rounded border border-watch/40 bg-watch/10 px-3 py-2 text-xs text-watch">
          Live numbers from Strike are unavailable right now ({d.liveError}). Retrying.
        </p>
      )}

      {p.demoAlerts && p.status === "active" && (
        <p className="mt-3 rounded border border-watch/40 bg-watch/10 px-3 py-2 text-xs text-watch">
          Demo setting on: Locke&apos;s alert levels are lowered so the alert and top-up flow shows without a real price move.
        </p>
      )}

      {urgent && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded border border-danger/60 bg-danger/10 p-4">
          <div>
            <div className="font-medium text-danger">
              {p.riskLevel === "action" ? "Action needed" : p.riskLevel === "margin_call" ? "Margin call on Strike" : "This plan is at risk"}
            </div>
            <div className="text-sm text-muted">
              Liquidation is {pct(p.liquidationDistance, 1)} away (margin ratio {pct(p.ratio, 1)}). Top up {usd(p.suggestedTopUpUsd)} to move it back to a safe distance.
            </div>
          </div>
          <Button onClick={() => setSheet("topup")}>Top up</Button>
        </div>
      )}

      {(p.status === "draft" || p.status === "funding" || p.status === "opening") && (
        <PendingPlan d={d} adaPrice={adaPrice} onChange={load} />
      )}

      {(p.status === "active" || p.status === "closing" || p.status === "closed") && (
        <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className={`bracket ${urgent ? "danger" : p.riskLevel === "watch" ? "watch" : "accent"} p-5`}>
            <div className="num text-5xl font-semibold tracking-tight">{h.value}</div>
            <div className="text-sm text-muted">{h.caption}</div>
            {p.status === "active" && (
              <div className="mt-6">
                <div className="mb-2 flex justify-between text-xs">
                  <span className="uppercase tracking-wider text-muted">Margin health</span>
                  <span className="num text-muted">{p.riskLevel === "ok" ? "Healthy" : p.riskLevel.replace("_", " ")}</span>
                </div>
                <MarginBar ratio={p.ratio} watch={p.thresholds.watch} action={p.thresholds.action} />
              </div>
            )}
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label="Hedge size" value={`${num(p.position?.size ?? p.sizing.size, 2)} ${p.symbol.split("-")[0]}`} sub={usd((p.position?.size ?? 0) * p.mark, 0)} />
              <Stat label="Funding to date" value={signedUsd(p.position?.fundingToDate ?? 0)} tone={(p.position?.fundingToDate ?? 0) >= 0 ? "ok" : "bad"} />
              <Stat label="Cost of protection" value={`${signedUsd(p.fundingPerDay)}/day`} sub={p.fundingPerDay >= 0 ? "received" : "paid"} />
              <Stat label="Hedge result" value={signedUsd(p.position?.upnl ?? 0)} sub="offsets the exposure" />
              <Stat label="Top-up asked at" value={price(p.alertPrice)} sub={`${p.symbol} mark ${price(p.mark)}`} />
              <Stat
                label="Liquidation"
                value={p.position && p.position.liquidationPrice == null ? "None" : price(p.position?.liquidationPrice)}
                sub={p.liquidationDistance != null ? `${pct(p.liquidationDistance, 1)} away` : undefined}
                tone="bad"
              />
            </div>
            {p.status === "active" && (
              <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Button variant="ghost" onClick={() => setSheet("topup")}>Top up</Button>
                <Button variant="ghost" onClick={() => setSheet("resize")}>Resize</Button>
                <Button variant="ghost" onClick={() => setShowReplay((v) => !v)}>Replay</Button>
                <Button variant="danger" onClick={() => setSheet("close")}>Close</Button>
              </div>
            )}
            {p.status === "closing" && <p className="mt-4 text-sm text-muted">Closing on Strike…</p>}
          </div>

          <div className="space-y-4">
            {p.type === "holdings" && <DelegationPanel q={(p.inputs as HoldingsInputs).amountHeld} />}
            <div className="bracket p-5">
              <h3 className="mb-3 text-xs uppercase tracking-wider text-muted">Activity</h3>
              <ol className="max-h-80 space-y-2.5 overflow-y-auto pr-1">
                {d.events.length === 0 && <li className="text-sm text-faint">No events yet.</li>}
                {d.events.map((e) => (
                  <li key={e.id} className="flex gap-2 text-sm">
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        e.level === "info" || e.level === "ok" ? "bg-accent" : e.level === "watch" ? "bg-watch" : "bg-danger"
                      }`}
                    />
                    <span className="flex-1">
                      {e.message}
                      <span className="ml-2 text-xs text-faint">{ago(e.created_at)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}

      {(p.status === "active" || p.status === "closed") && chartSeries.length > 0 && (
        <div className="bracket mt-4 p-5">
          <h3 className="mb-3 text-xs uppercase tracking-wider text-muted">{h.caption} since opening</h3>
          <LineChart series={chartSeries} height={180} format={(n) => (p.type === "holdings" ? usd(n, 0) : local(n, cur, 0))} />
        </div>
      )}

      {(showReplay || p.status === "closed") && p.status !== "draft" && (
        <div className="bracket mt-4 p-5">
          <ReplayPanel planId={p.id} type={p.type} currency={cur} litres={p.type === "costs" ? (p.inputs as CostsInputs).litresPerMonth : 1} />
        </div>
      )}

      {p.position && (
        <details className="bracket mt-4 p-5">
          <summary className="cursor-pointer text-sm text-muted">Strike details</summary>
          <dl className="num mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {[
              ["Market", p.symbol],
              ["Side", p.side === "sell" ? "Short" : "Long"],
              ["Size", num(p.position.size, 4)],
              ["Entry", price(p.position.entry)],
              ["Mark", price(p.mark)],
              ["Isolated balance", usd(p.position.isoBalance)],
              ["Maintenance margin", usd(p.position.maintenanceMargin)],
              ["Margin ratio", pct(p.ratio, 2)],
              ["Leverage", `${p.position.leverage}x`],
              ["Liquidation price", price(p.position.liquidationPrice)],
              ["Funding rate", `${pct(p.hourlyFundingRate, 4)}/h`],
              ["Builder fee", `${p.builderFeeBps} bps`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] uppercase tracking-wider text-faint">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {d.deposits.length > 0 && (
            <div className="mt-4 border-t border-line pt-3 text-xs text-muted">
              {d.deposits.map((x) => (
                <div key={x.id} className="num flex justify-between gap-2 py-0.5">
                  <span>
                    {x.purpose} · {num(Number(x.lovelace) / 1e6, 2)} ADA · {x.status}
                  </span>
                  {x.tx_hash && (
                    <a className="text-accent underline" href={`${CARDANOSCAN}${x.tx_hash}`} target="_blank" rel="noreferrer">
                      {shortAddr(x.tx_hash)}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </details>
      )}

      <TopUpSheet open={sheet === "topup"} onClose={() => setSheet(null)} plan={p} adaPrice={adaPrice} onDone={load} ensureWallet={ensureWallet} />
      <ResizeSheet open={sheet === "resize"} onClose={() => setSheet(null)} plan={p} onDone={load} />
      <CloseSheet
        open={sheet === "close"}
        onClose={() => setSheet(null)}
        plan={p}
        onDone={async () => {
          await load();
          void refreshMe();
        }}
      />
    </div>
  );
}

function PendingPlan({ d, adaPrice, onChange }: { d: Detail; adaPrice: number | null; onChange(): Promise<void> }) {
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
    } finally {
      setBusy(false);
    }
  };

  const waitingOnChain = p.status === "funding" && d.deposits.some((x) => x.purpose === "open" && x.status === "submitted");
  return (
    <div className="mt-6 space-y-4">
      {(p.status === "opening" || waitingOnChain) && (
        <div className="bracket accent p-5">
          <StepTracker step={p.status === "opening" ? "confirmed" : step} txHash={tx} />
          <p className="mt-4 text-sm text-muted">{p.statusNote ?? "Waiting on Strike…"}</p>
        </div>
      )}
      {!waitingOnChain && p.status !== "opening" && (
        <>
          {p.statusNote && <p className="rounded border border-line px-3 py-2 text-sm text-muted">{p.statusNote}</p>}
          {d.preview && <PreviewCard type={p.type} inputs={p.inputs} preview={d.preview} adaPrice={adaPrice} />}
          <details className="bracket p-5">
            <summary className="cursor-pointer text-sm text-muted">Replay this plan against real prices</summary>
            <div className="mt-4">
              <ReplayPanel
                planId={p.id}
                type={p.type}
                currency={p.type === "costs" ? (p.inputs as CostsInputs).currency : "USD"}
                litres={p.type === "costs" ? (p.inputs as CostsInputs).litresPerMonth : 1}
              />
            </div>
          </details>
          <ErrorNote error={error} />
          <div className="flex gap-3">
            <Button busy={busy} onClick={fund} className="flex-1">
              Fund and open
            </Button>
            <Button variant="ghost" disabled={busy} onClick={discard}>
              Discard
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function DelegationPanel({ q }: { q: number }) {
  const [data, setData] = useState<null | { pool: string | null; poolTicker: string | null; drep: string | null }>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api<{ delegation: typeof data }>("/api/delegation")
      .then((r) => setData(r.delegation))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  return (
    <div className="bracket p-5">
      <h3 className="mb-3 text-xs uppercase tracking-wider text-muted">Your ADA, still working</h3>
      {!loaded ? (
        <Spinner />
      ) : (
        <ul className="space-y-1.5 text-sm">
          <li>
            Still staked to{" "}
            <span className="num text-accent">{data?.poolTicker ?? (data?.pool ? shortAddr(data.pool) : "—")}</span>
          </li>
          <li>
            Still delegated to <span className="num text-accent">{data?.drep ? shortAddr(data.drep) : "no DRep"}</span>
          </li>
          <li>
            ADA covered by this plan: <span className="num">{num(q, 0)}</span>
          </li>
        </ul>
      )}
      <p className="mt-3 text-xs text-faint">The hedged ADA never moves. Only margin deposits leave your wallet.</p>
    </div>
  );
}

function TopUpSheet({
  open,
  onClose,
  plan,
  adaPrice,
  onDone,
  ensureWallet,
}: {
  open: boolean;
  onClose(): void;
  plan: PlanView;
  adaPrice: number | null;
  onDone(): Promise<void>;
  ensureWallet: ReturnType<typeof useWallet>["ensureWallet"];
}) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<DepositStep | null>(null);
  const [tx, setTx] = useState<string | undefined>();

  useEffect(() => {
    if (open) {
      setAmount(String(Math.max(6, Math.ceil(plan.suggestedTopUpUsd || 6))));
      setStep(null);
      setError(null);
      setTx(undefined);
    }
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
          <p className="mt-4 text-sm text-muted">
            Once Strike credits the deposit, Locke adds it to this plan&apos;s margin only. Your other plans are untouched.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {plan.riskLevel === "ok"
              ? "Adding margin moves this plan further from liquidation."
              : `Margin ratio is ${pct(plan.ratio, 1)}, above Locke's alert level. A top-up brings it back down.`}
          </p>
          <Field label="Amount (USD)" hint={adaPrice && usdAmt ? `≈ ${num(usdAmt / adaPrice, 1)} ADA from your wallet` : undefined}>
            <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Ratio now" value={pct(plan.ratio, 2)} />
            <Stat label="After top-up" value={pct(newRatio, 2)} tone="ok" />
          </div>
          <p className="text-xs text-faint">
            Each top-up sells a small slice of ADA into a USD balance on Strike, which slightly lowers the amount you have staked and voting.
            {plan.type === "holdings" && " After it credits, consider resizing the plan to match the ADA you now hold."}
          </p>
          <ErrorNote error={error} />
          <Button className="w-full" busy={busy} disabled={usdAmt < 6} onClick={submit}>
            Sign top-up
          </Button>
        </div>
      )}
    </Sheet>
  );
}

function ResizeSheet({ open, onClose, plan, onDone }: { open: boolean; onClose(): void; plan: PlanView; onDone(): Promise<void> }) {
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
    <Sheet open={open} onClose={onClose} title="Resize hedge">
      {isHoldings ? (
        <div className="space-y-4">
          <Field label="ADA held">
            <input className={inputCls} inputMode="numeric" value={held} onChange={(e) => setHeld(e.target.value)} />
          </Field>
          <Field label={`Share to protect: ${share}%`} hint={`New hedge ≈ ${num(Math.floor((Number(held) * share) / 100), 0)} ADA (now ${num(plan.position?.size, 0)})`}>
            <input type="range" min={10} max={100} step={5} value={share} onChange={(e) => setShare(Number(e.target.value))} className="w-full" />
          </Field>
          <ErrorNote error={error} />
          <Button className="w-full" busy={busy} onClick={() => submit({ sharePct: share, amountHeld: Number(held) })}>
            Resize on Strike
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Each month, close the part of the hedge that matched the fuel you&apos;ve used: {num((plan.position?.size ?? 0) / c.months, 2)} WTI
            of {num(plan.position?.size, 2)} ({c.months} month{c.months === 1 ? "" : "s"} left).
          </p>
          <ErrorNote error={error} />
          <Button className="w-full" busy={busy} disabled={c.months <= 1} onClick={() => submit({ action: "month" })}>
            Close one month
          </Button>
        </div>
      )}
    </Sheet>
  );
}

function CloseSheet({ open, onClose, plan, onDone }: { open: boolean; onClose(): void; plan: PlanView; onDone(): Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet open={open} onClose={onClose} title="Close this plan?">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Locke sends a reduce-only order that closes the whole hedge at market. The plan&apos;s margin returns to your Strike balance, which
          you can withdraw to your wallet.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Hedge result" value={signedUsd(plan.position?.upnl)} />
          <Stat label="Funding to date" value={signedUsd(plan.position?.fundingToDate)} />
        </div>
        <ErrorNote error={error} />
        <Button
          variant="danger"
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
