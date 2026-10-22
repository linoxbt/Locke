"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { PreviewCard } from "@/components/PreviewCard";
import { runDeposit, StepTracker, type DepositStep } from "@/components/DepositFlow";
import { Arrow, Button, Card, Display, ErrorNote, Eyebrow, Field, inputCls, Segmented, Slider, SUBTLE } from "@/components/ui";
import { useWallet } from "@/components/WalletProvider";
import { walletAda } from "@/lib/cardano/wallet";
import type { CostsInputs, HoldingsInputs, PlanType, Preview } from "@/lib/domain/types";
import { api, errorMessage } from "@/lib/ui/api";
import { num, usd } from "@/lib/ui/format";

type Stage = "choose" | "describe" | "preview" | "opening";

const DEFAULT_COSTS: CostsInputs = {
  fuelType: "diesel",
  litresPerMonth: 2000,
  pumpPrice: 1250,
  fxRate: 1530,
  currency: "NGN",
  months: 3,
  crudeSharePct: 50,
  leverage: 1,
  bufferPct: 25,
};

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
  const [costs, setCosts] = useState<CostsInputs>(DEFAULT_COSTS);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [adaPrice, setAdaPrice] = useState<number | null>(null);
  const [wtiPrice, setWtiPrice] = useState<number | null>(null);
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
    api<{ ada: { mark: number }; wti: { mark: number } }>("/api/market")
      .then((m) => {
        setAdaPrice(m.ada.mark);
        setWtiPrice(m.wti.mark);
      })
      .catch(() => {});
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

  const go = (s: Stage) => {
    setStage(s);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const choose = (t: PlanType) => {
    setType(t);
    setPreview(null);
    router.replace(`/protect?type=${t}`);
    go("describe");
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
      go("preview");
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
    go("opening");
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
        // Enough free balance on Strike already: open straight away.
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
  const tone = type === "costs" ? "lime" : "cobalt";

  return (
    <div className="animate-rise">
      <Progress stage={stage} />

      {stage === "choose" && (
        <>
          <Display lead="What do you want to protect?" rest="Pick one. You can add the other later." className="max-w-[16ch]" />
          <div className="mt-12 grid grid-cols-1 gap-3 md:grid-cols-2">
            <ChoiceCard
              tone="cobalt"
              n="01"
              title="Holdings"
              line="Protect what your business holds"
              body="A fall in the value of ADA in your treasury. Direct hedge on ADA-USD."
              onClick={() => choose("holdings")}
            />
            <ChoiceCard
              tone="lime"
              n="02"
              title="Operating costs"
              line="Manage what it needs to buy"
              body="A rise in what you pay for diesel or petrol. Partial hedge on WTI crude."
              onClick={() => choose("costs")}
            />
          </div>
        </>
      )}

      {stage === "describe" && type && (
        <>
          <BackLink onClick={() => go("choose")}>What to protect</BackLink>
          <Display
            lead={type === "holdings" ? "Protect your ADA." : "Manage your fuel costs."}
            rest={type === "holdings" ? "Tell Locke how much to cover." : "Tell Locke what you burn."}
            className="max-w-[18ch]"
          />
          <div className="mt-10 grid grid-cols-1 gap-3 lg:grid-cols-12">
            <Card className="space-y-7 lg:col-span-7">
              {type === "holdings" ? (
                <HoldingsForm v={holdings} set={setHoldings} walletBalance={walletBalance} />
              ) : (
                <CostsForm v={costs} set={setCosts} />
              )}
            </Card>
            <div className="lg:col-span-5">
              <Card tone={tone} className="flex flex-col lg:sticky lg:top-24 lg:min-h-[420px]">
                <Eyebrow className={SUBTLE[tone]}>{type === "holdings" ? "You'll protect" : "Crude-linked spend"}</Eyebrow>
                <Summary type={type} holdings={holdings} costs={costs} adaPrice={adaPrice} wtiPrice={wtiPrice} />
                <div className="mt-auto space-y-3 pt-10">
                  <ErrorNote error={error} />
                  <Button variant={type === "holdings" ? "paper" : "ink"} size="lg" className="w-full justify-between" busy={busy} onClick={doPreview}>
                    Preview plan <Arrow />
                  </Button>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}

      {stage === "preview" && type && preview && (
        <>
          <BackLink onClick={() => go("describe")}>Edit plan</BackLink>
          <Display lead="Your protection plan." rest="Check it, then fund it." className="mb-10 max-w-[16ch]" />
          <PreviewCard type={type} inputs={type === "holdings" ? holdings : costs} preview={preview} adaPrice={adaPrice} />
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-12">
            <Card tone="mist" className="lg:col-span-8">
              <h3 className="display text-[24px]">Before you open a plan</h3>
              <ul className="mt-5 space-y-3 text-[15px] leading-relaxed text-ink-2">
                <li>Locke is a tool, not financial advice; you decide what to protect.</li>
                <li>Hedges can lose money on their own: a holdings hedge gives up upside, a fuel hedge loses if fuel prices fall.</li>
                {type === "costs" && <li>The fuel plan is partial: local prices also move with exchange rates, taxes and policy.</li>}
                <li>Positions can be liquidated if margin runs out. Locke alerts you first, but can&apos;t top up without your signature.</li>
                <li>The deposit converts ADA to a USD balance on Strike, which slightly lowers the ADA you have staked.</li>
                <li>
                  Strike has eligibility rules; check{" "}
                  <a className="text-ink underline underline-offset-4" href="https://docs.strikefinance.org" target="_blank" rel="noreferrer">
                    Strike&apos;s restricted persons policy
                  </a>
                  .
                </li>
              </ul>
            </Card>
            <Card className="flex flex-col lg:col-span-4">
              <label className="flex cursor-pointer items-start gap-3 text-[15px]">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-cobalt)]"
                />
                I understand the risks above and want Locke to open this hedge.
              </label>
              <div className="mt-auto space-y-3 pt-8">
                <ErrorNote error={error} />
                <Button size="lg" className="w-full justify-between" disabled={!accepted} busy={busy} onClick={fundAndOpen}>
                  Fund and open <Arrow />
                </Button>
              </div>
            </Card>
          </div>
        </>
      )}

      {stage === "opening" && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Display lead={step === "open" ? "You're protected." : "Opening your plan."} rest={step === "open" ? "Locke is watching it." : "This takes a few minutes."} />
            <p className="mt-6 max-w-[40ch] text-[16px] leading-relaxed text-ink-2">
              {step === "submitted"
                ? "Cardano needs a few confirmations before Strike credits the deposit. You can leave this page; Locke finishes opening the plan."
                : step === "open"
                  ? "The hedge is live on Strike with its own isolated margin."
                  : "Keep your wallet open to sign."}
            </p>
            {note && step !== "open" && <p className="mt-4 text-[14px] text-ink-3">{note}</p>}
          </div>
          <Card tone="mist" className="lg:col-span-7">
            <StepTracker step={step} txHash={txHash} failed={!!error} skipDeposit={skipDeposit} />
            <div className="mt-6 space-y-3">
              <ErrorNote error={error} />
              <div className="flex flex-wrap gap-2">
                {error && planId && (
                  <Button variant="ghost" onClick={() => go("preview")}>
                    Back to preview
                  </Button>
                )}
                {planId && (
                  <Link href={`/plans/${planId}`} className="ml-auto">
                    <Button variant={step === "open" ? "primary" : "ghost"}>
                      View plan <Arrow />
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Progress({ stage }: { stage: Stage }) {
  const order: Stage[] = ["choose", "describe", "preview", "opening"];
  const labels = ["Protect", "Describe", "Preview", "Fund"];
  const i = order.indexOf(stage);
  return (
    <ol className="mb-10 flex gap-1.5" aria-label="Progress">
      {labels.map((l, k) => (
        <li key={l} className="flex-1" aria-current={k === i ? "step" : undefined}>
          <div className={`h-1 rounded-full transition-colors ${k <= i ? "bg-ink" : "bg-line"}`} />
          <span className={`eyebrow mt-2 block ${k <= i ? "text-ink" : "text-ink-3"}`}>{l}</span>
        </li>
      ))}
    </ol>
  );
}

function BackLink({ onClick, children }: { onClick(): void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="mb-6 inline-flex h-10 items-center gap-2 rounded-full bg-paper px-4 text-[14px] text-ink-2 hover:text-ink">
      <Arrow className="rotate-180" /> {children}
    </button>
  );
}

function ChoiceCard({
  tone,
  n,
  title,
  line,
  body,
  onClick,
}: {
  tone: "cobalt" | "lime";
  n: string;
  title: string;
  line: string;
  body: string;
  onClick(): void;
}) {
  return (
    <button onClick={onClick} className="group text-left">
      <Card tone={tone} className="flex min-h-[340px] flex-col transition-transform duration-300 group-hover:-translate-y-1 sm:min-h-[420px]">
        <div className="flex items-center justify-between">
          <Eyebrow className={SUBTLE[tone]}>
            {n} · {title}
          </Eyebrow>
          <span className={`grid h-12 w-12 place-items-center rounded-full transition-transform duration-300 group-hover:rotate-[-45deg] ${tone === "cobalt" ? "bg-paper text-cobalt" : "bg-ink text-lime"}`}>
            <Arrow />
          </span>
        </div>
        <span className="display mt-auto block pt-12 text-[40px] sm:text-[56px]">{line}</span>
        <span className={`mt-4 block max-w-[40ch] text-[16px] ${SUBTLE[tone]}`}>{body}</span>
      </Card>
    </button>
  );
}

function NumberInput({ value, onChange, min, suffix, id }: { value: number; onChange(n: number): void; min?: number; suffix?: string; id?: string }) {
  return (
    <div className="relative">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        className={inputCls}
        value={Number.isFinite(value) ? value : ""}
        min={min}
        onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
      />
      {suffix && <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[15px] text-ink-3">{suffix}</span>}
    </div>
  );
}

function RiskControls<T extends { leverage: number; bufferPct: number }>({ v, set }: { v: T; set(f: (x: T) => T): void }) {
  return (
    <details className="group rounded-2xl bg-mist/60 p-4 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer items-center justify-between text-[15px]">
        <span>
          Leverage and buffer <span className="num ml-2 text-ink-3">{v.leverage}x · {v.bufferPct}%</span>
        </span>
        <span className="text-ink-3 transition group-open:rotate-45">+</span>
      </summary>
      <div className="mt-5 space-y-5">
        <Field group label="Leverage" hint="Higher leverage needs less margin but liquidates sooner.">
          <Segmented label="Leverage" value={v.leverage} onChange={(l) => set((x) => ({ ...x, leverage: l }))} options={[1, 2, 3].map((l) => ({ value: l, label: <span className="num">{l}x</span> }))} />
        </Field>
        <Field label="Margin buffer" hint="Extra margin above the minimum.">
          <NumberInput value={v.bufferPct} min={0} suffix="%" onChange={(n) => set((x) => ({ ...x, bufferPct: n }))} />
        </Field>
      </div>
    </details>
  );
}

function HoldingsForm({
  v,
  set,
  walletBalance,
}: {
  v: HoldingsInputs;
  set: React.Dispatch<React.SetStateAction<HoldingsInputs>>;
  walletBalance: number | null;
}) {
  return (
    <>
      <Field
        label="ADA your business holds"
        hint={
          walletBalance != null
            ? `${num(walletBalance, 0)} ADA in this wallet. Edit to include ADA your treasury holds elsewhere.`
            : "Connect your wallet to pre-fill this."
        }
      >
        <NumberInput value={v.amountHeld} min={1} suffix="ADA" onChange={(n) => set((x) => ({ ...x, amountHeld: n }))} />
      </Field>
      <Field label={<span className="flex justify-between">Share to protect <span className="num text-ink">{v.sharePct}%</span></span>}>
        <Slider label="Share to protect" min={10} max={100} step={5} value={v.sharePct} onChange={(n) => set((x) => ({ ...x, sharePct: n }))} />
      </Field>
      <RiskControls v={v} set={set} />
    </>
  );
}

function CostsForm({ v, set }: { v: CostsInputs; set: React.Dispatch<React.SetStateAction<CostsInputs>> }) {
  return (
    <>
      <Field group label="Fuel">
        <Segmented
          label="Fuel"
          value={v.fuelType}
          onChange={(f) => set((x) => ({ ...x, fuelType: f }))}
          options={[
            { value: "diesel", label: "Diesel" },
            { value: "petrol", label: "Petrol" },
          ]}
        />
      </Field>
      <Field label="Litres per month">
        <NumberInput value={v.litresPerMonth} min={1} suffix="L" onChange={(n) => set((x) => ({ ...x, litresPerMonth: n }))} />
      </Field>
      <div className="grid grid-cols-[96px_1fr] gap-3 sm:grid-cols-[110px_1fr_1fr]">
        <Field label="Currency">
          <input className={inputCls} maxLength={3} value={v.currency} onChange={(e) => set((x) => ({ ...x, currency: e.target.value.toUpperCase() }))} />
        </Field>
        <Field label="Pump price per litre">
          <NumberInput value={v.pumpPrice} min={0} onChange={(n) => set((x) => ({ ...x, pumpPrice: n }))} />
        </Field>
        <div className="col-span-2 sm:col-span-1">
          <Field label={`${v.currency || "Local"} per US dollar`}>
            <NumberInput value={v.fxRate} min={0} onChange={(n) => set((x) => ({ ...x, fxRate: n }))} />
          </Field>
        </div>
      </div>
      <Field label={<span className="flex justify-between">Months covered <span className="num text-ink">{v.months}</span></span>}>
        <Slider label="Months covered" min={1} max={6} value={v.months} onChange={(n) => set((x) => ({ ...x, months: n }))} className="text-ink" />
      </Field>
      <Field
        label={<span className="flex justify-between">Crude share <span className="num text-ink">{v.crudeSharePct}%</span></span>}
        hint="Your assumption: the part of the pump price that moves with crude oil. The rest follows FX, taxes and policy."
      >
        <Slider label="Crude share" min={0} max={100} step={5} value={v.crudeSharePct} onChange={(n) => set((x) => ({ ...x, crudeSharePct: n }))} className="text-ink" />
      </Field>
      <RiskControls v={v} set={set} />
    </>
  );
}

function Summary({
  type,
  holdings,
  costs,
  adaPrice,
  wtiPrice,
}: {
  type: PlanType;
  holdings: HoldingsInputs;
  costs: CostsInputs;
  adaPrice: number | null;
  wtiPrice: number | null;
}) {
  if (type === "holdings") {
    const hedged = Math.floor((holdings.amountHeld * holdings.sharePct) / 100) || 0;
    return (
      <>
        <div className="num mt-8 text-[56px] leading-none sm:text-[72px]">{num(hedged, 0)}</div>
        <div className={`mt-2 text-[15px] ${SUBTLE.cobalt}`}>ADA hedged{adaPrice ? ` ≈ ${usd(hedged * adaPrice, 0)} at today's price` : ""}</div>
        <p className={`mt-8 text-[15px] leading-relaxed ${SUBTLE.cobalt}`}>
          {holdings.sharePct}% of {num(holdings.amountHeld || 0, 0)} ADA. Margin needed ≈{" "}
          {adaPrice ? usd((hedged * adaPrice * (1 + holdings.bufferPct / 100)) / holdings.leverage, 0) : "—"}.
        </p>
      </>
    );
  }
  const monthly = costs.litresPerMonth * costs.pumpPrice;
  const exposureUsd = ((costs.crudeSharePct / 100) * monthly * costs.months) / (costs.fxRate || 1);
  return (
    <>
      <div className="num mt-8 text-[56px] leading-none sm:text-[72px]">{usd(exposureUsd, 0)}</div>
      <div className={`mt-2 text-[15px] ${SUBTLE.lime}`}>
        over {costs.months} month{costs.months === 1 ? "" : "s"}
        {wtiPrice ? ` ≈ ${num(exposureUsd / wtiPrice, 2)} WTI` : ""}
      </div>
      <p className={`mt-8 text-[15px] leading-relaxed ${SUBTLE.lime}`}>
        Monthly fuel bill ≈ {costs.currency} {num(monthly, 0)} (≈ {usd(monthly / (costs.fxRate || 1), 0)}). Locke hedges the {costs.crudeSharePct}% that
        moves with crude.
      </p>
    </>
  );
}
