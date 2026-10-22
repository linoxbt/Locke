"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { PreviewCard } from "@/components/PreviewCard";
import { runDeposit, StepTracker, type DepositStep } from "@/components/DepositFlow";
import { Button, ErrorNote, Field, inputCls } from "@/components/ui";
import { useWallet } from "@/components/WalletProvider";
import { walletAda } from "@/lib/cardano/wallet";
import type { CostsInputs, HoldingsInputs, PlanType, Preview } from "@/lib/domain/types";
import { api, errorMessage } from "@/lib/ui/api";
import { num } from "@/lib/ui/format";

type Stage = "choose" | "describe" | "preview" | "opening";

export default function ProtectPage() {
  return (
    <Suspense>
      <Wizard />
    </Suspense>
  );
}

function Wizard() {
  const params = useSearchParams();
  const router = useRouter();
  const { me, loading, ensureWallet, refreshMe } = useWallet();
  const initialType = params.get("type") === "costs" ? "costs" : params.get("type") === "holdings" ? "holdings" : null;
  const [type, setType] = useState<PlanType | null>(initialType);
  const [stage, setStage] = useState<Stage>(initialType ? "describe" : "choose");
  const [holdings, setHoldings] = useState<HoldingsInputs>({ asset: "ADA", amountHeld: 0, sharePct: 60, leverage: 1, bufferPct: 25 });
  const [costs, setCosts] = useState<CostsInputs>({
    fuelType: "diesel",
    litresPerMonth: 2000,
    pumpPrice: 1250,
    fxRate: 1530,
    currency: "NGN",
    months: 3,
    crudeSharePct: 50,
    leverage: 1,
    bufferPct: 25,
  });
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [adaPrice, setAdaPrice] = useState<number | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<DepositStep>("quote");
  const [txHash, setTxHash] = useState<string | undefined>();
  const [skipDeposit, setSkipDeposit] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!loading && !me) router.replace("/");
  }, [loading, me, router]);

  useEffect(() => {
    api<{ ada: { mark: number } }>("/api/market").then((m) => setAdaPrice(m.ada.mark)).catch(() => {});
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, []);

  // Pre-fill ADA held from the wallet for the holdings plan.
  useEffect(() => {
    if (type !== "holdings" || !me) return;
    ensureWallet()
      .then(walletAda)
      .then((ada) => {
        setWalletBalance(ada);
        setHoldings((h) => (h.amountHeld ? h : { ...h, amountHeld: ada }));
      })
      .catch(() => {});
  }, [type, me, ensureWallet]);

  const choose = (t: PlanType) => {
    setType(t);
    setStage("describe");
    setPreview(null);
    router.replace(`/protect?type=${t}`);
  };

  const doPreview = async () => {
    if (!type) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ planId: string; preview: Preview }>("/api/plans", {
        body: { type, inputs: type === "holdings" ? holdings : costs },
      });
      setPlanId(r.planId);
      setPreview(r.preview);
      setStage("preview");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const watchUntilOpen = useCallback(
    (id: string) => {
      if (poll.current) clearInterval(poll.current);
      const tick = async () => {
        try {
          const r = await api<{ status: string; statusNote: string | null }>(`/api/plans/${id}/sync`, { body: {} });
          setNote(r.statusNote);
          if (r.status === "opening") setStep((s) => (s === "open" ? s : "confirmed"));
          if (r.status === "active") {
            setStep("open");
            if (poll.current) clearInterval(poll.current);
            void refreshMe();
          }
        } catch (e) {
          setNote(errorMessage(e));
        }
      };
      void tick();
      poll.current = setInterval(tick, 5000);
    },
    [refreshMe]
  );

  const fundAndOpen = async () => {
    if (!planId) return;
    setBusy(true);
    setError(null);
    setStage("opening");
    try {
      const w = await ensureWallet();
      const dep = await runDeposit({
        wallet: w,
        planId,
        purpose: "open",
        onStep: (s, info) => {
          setStep(s);
          if (info?.txHash) setTxHash(info.txHash);
        },
      });
      if (!dep) {
        // Enough balance on Strike already: open straight away.
        setSkipDeposit(true);
        await api(`/api/plans/${planId}/open`, { body: {} });
        setStep("confirmed");
      }
      watchUntilOpen(planId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!me) return null;

  return (
    <div className="mx-auto max-w-2xl">
      {stage === "choose" && (
        <>
          <h1 className="text-2xl font-semibold">What do you want to protect?</h1>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <ChoiceCard title="Holdings" line="Protect what your business holds" body="A fall in the value of ADA in your treasury. Direct hedge on ADA-USD." onClick={() => choose("holdings")} />
            <ChoiceCard title="Operating costs" line="Manage what it needs to buy" body="A rise in what you pay for diesel or petrol. Partial hedge on WTI crude." onClick={() => choose("costs")} />
          </div>
        </>
      )}

      {stage === "describe" && type && (
        <>
          <Back onClick={() => setStage("choose")} label="What to protect" />
          <h1 className="text-2xl font-semibold">{type === "holdings" ? "Protect your ADA" : "Manage your fuel costs"}</h1>
          <div className="bracket mt-6 space-y-5 p-5">
            {type === "holdings" ? (
              <HoldingsForm v={holdings} set={setHoldings} walletBalance={walletBalance} adaPrice={adaPrice} />
            ) : (
              <CostsForm v={costs} set={setCosts} />
            )}
          </div>
          <div className="mt-4">
            <ErrorNote error={error} />
          </div>
          <Button className="mt-4 w-full" busy={busy} onClick={doPreview}>
            Preview plan
          </Button>
        </>
      )}

      {stage === "preview" && type && preview && (
        <>
          <Back onClick={() => setStage("describe")} label="Edit plan" />
          <h1 className="mb-4 text-2xl font-semibold">Preview</h1>
          <PreviewCard type={type} inputs={type === "holdings" ? holdings : costs} preview={preview} adaPrice={adaPrice} />
          <div className="mt-5 rounded border border-line p-4 text-sm text-muted">
            <p className="font-medium text-text">Before you open a plan</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Locke is a tool, not financial advice; you decide what to protect.</li>
              <li>Hedges can lose money on their own: a holdings hedge gives up upside, a fuel hedge loses if fuel prices fall.</li>
              {type === "costs" && <li>The fuel plan is partial: local prices also move with exchange rates, taxes and policy.</li>}
              <li>Positions can be liquidated if margin runs out. Locke alerts you first, but can&apos;t top up without your signature.</li>
              <li>The deposit converts ADA to a USD balance on Strike; it slightly lowers the ADA you have staked.</li>
              <li>
                Strike has eligibility rules; check{" "}
                <a className="text-accent underline" href="https://docs.strikefinance.org" target="_blank" rel="noreferrer">
                  Strike&apos;s restricted persons policy
                </a>
                .
              </li>
            </ul>
            <label className="mt-3 flex items-center gap-2 text-text">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
              I understand
            </label>
          </div>
          <ErrorNote error={error} />
          <Button className="mt-4 w-full" disabled={!accepted} busy={busy} onClick={fundAndOpen}>
            Fund and open
          </Button>
        </>
      )}

      {stage === "opening" && (
        <>
          <h1 className="mb-6 text-2xl font-semibold">Opening your plan</h1>
          <div className="bracket accent p-5">
            <StepTracker step={step} txHash={txHash} failed={!!error} skipDeposit={skipDeposit} />
            {step === "submitted" && (
              <p className="mt-4 text-sm text-muted">Cardano needs a few confirmations before Strike credits the deposit. This usually takes 1–3 minutes. You can leave this page; Locke finishes opening the plan.</p>
            )}
            {note && step !== "open" && <p className="mt-3 text-xs text-faint">{note}</p>}
          </div>
          <div className="mt-4">
            <ErrorNote error={error} />
          </div>
          <div className="mt-4 flex gap-3">
            {error && planId && (
              <Button variant="ghost" onClick={() => { setStage("preview"); setError(null); }}>
                Back to preview
              </Button>
            )}
            {planId && (
              <Link href={`/plans/${planId}`} className="ml-auto">
                <Button variant={step === "open" ? "primary" : "ghost"}>View plan</Button>
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Back({ onClick, label }: { onClick(): void; label: string }) {
  return (
    <button onClick={onClick} className="mb-3 text-sm text-muted hover:text-text">
      ← {label}
    </button>
  );
}

function ChoiceCard({ title, line, body, onClick }: { title: string; line: string; body: string; onClick(): void }) {
  return (
    <button onClick={onClick} className="bracket group p-5 text-left transition hover:[--b:var(--color-accent)]">
      <span className="num text-xs uppercase tracking-wider text-accent">{title}</span>
      <span className="mt-2 block text-lg font-medium">{line}</span>
      <span className="mt-2 block text-sm text-muted">{body}</span>
      <span className="mt-4 block text-sm text-accent opacity-0 transition group-hover:opacity-100">Choose →</span>
    </button>
  );
}

function NumberInput({ value, onChange, step, min }: { value: number; onChange(n: number): void; step?: number; min?: number }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      className={inputCls}
      value={Number.isFinite(value) ? value : ""}
      step={step}
      min={min}
      onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
    />
  );
}

function LeverageAndBuffer<T extends { leverage: number; bufferPct: number }>({ v, set }: { v: T; set(f: (x: T) => T): void }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Field label="Leverage" hint="Higher leverage needs less margin but liquidates sooner.">
        <div className="flex gap-2">
          {[1, 2, 3].map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => set((x) => ({ ...x, leverage: l }))}
              className={`num h-11 flex-1 rounded border ${v.leverage === l ? "border-accent text-accent" : "border-line text-muted"}`}
            >
              {l}x
            </button>
          ))}
        </div>
      </Field>
      <Field label="Margin buffer" hint="Extra margin above the minimum.">
        <div className="relative">
          <NumberInput value={v.bufferPct} min={0} step={5} onChange={(n) => set((x) => ({ ...x, bufferPct: n }))} />
          <span className="pointer-events-none absolute right-3 top-3 text-sm text-faint">%</span>
        </div>
      </Field>
    </div>
  );
}

function HoldingsForm({
  v,
  set,
  walletBalance,
  adaPrice,
}: {
  v: HoldingsInputs;
  set: React.Dispatch<React.SetStateAction<HoldingsInputs>>;
  walletBalance: number | null;
  adaPrice: number | null;
}) {
  const hedged = Math.floor((v.amountHeld * v.sharePct) / 100);
  return (
    <>
      <Field label="Asset">
        <div className="num flex h-11 items-center rounded border border-line bg-panel-2 px-3 text-muted">ADA · Cardano</div>
      </Field>
      <Field
        label="ADA held"
        hint={
          walletBalance != null
            ? `${num(walletBalance, 0)} ADA in this wallet. Edit to cover ADA your treasury holds elsewhere.`
            : "Connect your wallet to pre-fill this."
        }
      >
        <NumberInput value={v.amountHeld} min={1} onChange={(n) => set((x) => ({ ...x, amountHeld: n }))} />
      </Field>
      <Field label={`Share to protect: ${v.sharePct}%`} hint={`${num(hedged, 0)} ADA${adaPrice ? ` ≈ $${num(hedged * adaPrice, 0)}` : ""} hedged`}>
        <input type="range" min={10} max={100} step={5} value={v.sharePct} onChange={(e) => set((x) => ({ ...x, sharePct: Number(e.target.value) }))} className="w-full" />
      </Field>
      <LeverageAndBuffer v={v} set={set} />
    </>
  );
}

function CostsForm({ v, set }: { v: CostsInputs; set: React.Dispatch<React.SetStateAction<CostsInputs>> }) {
  const monthly = v.litresPerMonth * v.pumpPrice;
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Fuel">
          <div className="flex gap-2">
            {(["diesel", "petrol"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => set((x) => ({ ...x, fuelType: f }))}
                className={`h-11 flex-1 rounded border text-sm capitalize ${v.fuelType === f ? "border-accent text-accent" : "border-line text-muted"}`}
              >
                {f}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Litres per month">
          <NumberInput value={v.litresPerMonth} min={1} onChange={(n) => set((x) => ({ ...x, litresPerMonth: n }))} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Field label="Currency">
          <input className={inputCls} maxLength={3} value={v.currency} onChange={(e) => set((x) => ({ ...x, currency: e.target.value.toUpperCase() }))} />
        </Field>
        <Field label="Pump price / L">
          <NumberInput value={v.pumpPrice} min={0} onChange={(n) => set((x) => ({ ...x, pumpPrice: n }))} />
        </Field>
        <Field label={`${v.currency || "Local"} per USD`}>
          <NumberInput value={v.fxRate} min={0} onChange={(n) => set((x) => ({ ...x, fxRate: n }))} />
        </Field>
      </div>
      <p className="num -mt-2 text-xs text-faint">
        Monthly fuel bill ≈ {v.currency} {num(monthly, 0)} ≈ ${num(monthly / (v.fxRate || 1), 0)}
      </p>
      <Field label={`Months covered: ${v.months}`}>
        <input type="range" min={1} max={6} value={v.months} onChange={(e) => set((x) => ({ ...x, months: Number(e.target.value) }))} className="w-full" />
      </Field>
      <Field
        label={`Crude share: ${v.crudeSharePct}%`}
        hint="An assumption: the part of your pump price you believe moves with crude oil. The rest follows FX, taxes and policy."
      >
        <input type="range" min={0} max={100} step={5} value={v.crudeSharePct} onChange={(e) => set((x) => ({ ...x, crudeSharePct: Number(e.target.value) }))} className="w-full" />
      </Field>
      <LeverageAndBuffer v={v} set={set} />
    </>
  );
}
