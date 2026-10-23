"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Field, Segmented, Slider } from "../form";
import { Arrow, Button, Card, Display, ErrorNote, Eyebrow, inputCls, SUBTLE } from "../ui";
import { useWallet } from "../WalletProvider";
import { walletAda } from "@/lib/cardano/wallet";
import type { CostsInputs, HoldingsInputs, PlanType } from "@/lib/domain/types";
import { api, errorMessage } from "@/lib/ui/api";
import { num, usd } from "@/lib/ui/format";

const DEFAULT_HOLDINGS: HoldingsInputs = { asset: "ADA", amountHeld: 0, sharePct: 60, leverage: 1, bufferPct: 25 };
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

/** Describe step for one plan type. Submitting creates a draft and opens its preview page. */
export function PlanForm({ type, adaPrice, wtiPrice }: { type: PlanType; adaPrice: number | null; wtiPrice: number | null }) {
  const router = useRouter();
  const { ensureWallet } = useWallet();
  const [holdings, setHoldings] = useState<HoldingsInputs>(DEFAULT_HOLDINGS);
  const [costs, setCosts] = useState<CostsInputs>(DEFAULT_COSTS);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tone = type === "costs" ? "lime" : "cobalt";

  useEffect(() => {
    if (type !== "holdings") return;
    ensureWallet()
      .then(walletAda)
      .then((ada) => {
        setWalletBalance(ada);
        setHoldings((h) => (h.amountHeld ? h : { ...h, amountHeld: ada }));
      })
      .catch(() => {});
  }, [type, ensureWallet]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ planId: string }>("/api/plans", { body: { type, inputs: type === "holdings" ? holdings : costs } });
      router.push(`/plans/${r.planId}/preview`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Display
        lead={type === "holdings" ? "Protect your ADA." : "Manage your fuel costs."}
        rest={type === "holdings" ? "Tell Locke how much to cover." : "Tell Locke what you burn."}
        className="max-w-[18ch]"
      />
      <div className="mt-7 grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Card className="space-y-7 lg:col-span-7">
          {type === "holdings" ? <HoldingsFields v={holdings} set={setHoldings} walletBalance={walletBalance} /> : <CostsFields v={costs} set={setCosts} />}
        </Card>
        <div className="lg:col-span-5">
          <Card tone={tone} className="flex flex-col lg:sticky lg:top-24 lg:min-h-[234px]">
            <Eyebrow className={SUBTLE[tone]}>{type === "holdings" ? "You'll protect" : "Crude-linked spend"}</Eyebrow>
            <Summary type={type} holdings={holdings} costs={costs} adaPrice={adaPrice} wtiPrice={wtiPrice} />
            <div className="mt-auto space-y-3 pt-8">
              <ErrorNote error={error} />
              <Button type="submit" variant={type === "holdings" ? "paper" : "ink"} size="lg" className="w-full justify-between" busy={busy}>
                Preview plan <Arrow />
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </form>
  );
}

function NumberInput({ value, onChange, min, suffix }: { value: number; onChange(n: number): void; min?: number; suffix?: string }) {
  return (
    <div className="relative">
      <input
        type="number"
        inputMode="decimal"
        step="any"
        className={inputCls}
        value={Number.isFinite(value) ? value : ""}
        min={min}
        onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
      />
      {suffix && <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[14px] text-ink-3">{suffix}</span>}
    </div>
  );
}

function RiskControls<T extends { leverage: number; bufferPct: number }>({ v, set }: { v: T; set(f: (x: T) => T): void }) {
  return (
    <details className="group rounded-2xl bg-mist/60 p-4 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer items-center justify-between text-[14px]">
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

function HoldingsFields({ v, set, walletBalance }: { v: HoldingsInputs; set: React.Dispatch<React.SetStateAction<HoldingsInputs>>; walletBalance: number | null }) {
  return (
    <>
      <Field
        label="ADA your business holds"
        hint={walletBalance != null ? `${num(walletBalance, 0)} ADA in this wallet. Edit to include ADA your treasury holds elsewhere.` : "Open your wallet to pre-fill this."}
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

function CostsFields({ v, set }: { v: CostsInputs; set: React.Dispatch<React.SetStateAction<CostsInputs>> }) {
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

function Summary({ type, holdings, costs, adaPrice, wtiPrice }: { type: PlanType; holdings: HoldingsInputs; costs: CostsInputs; adaPrice: number | null; wtiPrice: number | null }) {
  if (type === "holdings") {
    const hedged = Math.floor((holdings.amountHeld * holdings.sharePct) / 100) || 0;
    return (
      <>
        <div className="num mt-6 text-[28px] leading-none sm:text-[34px]">{num(hedged, 0)}</div>
        <div className={`mt-2 text-[14px] ${SUBTLE.cobalt}`}>ADA hedged{adaPrice ? ` ≈ ${usd(hedged * adaPrice, 0)} at today's price` : ""}</div>
        <p className={`mt-6 text-[14px] leading-relaxed ${SUBTLE.cobalt}`}>
          {holdings.sharePct}% of {num(holdings.amountHeld || 0, 0)} ADA. Margin needed ≈{" "}
          {adaPrice ? usd((hedged * adaPrice * (1 + (holdings.bufferPct || 0) / 100)) / holdings.leverage, 0) : "—"}.
        </p>
      </>
    );
  }
  const monthly = costs.litresPerMonth * costs.pumpPrice;
  const exposureUsd = ((costs.crudeSharePct / 100) * monthly * costs.months) / (costs.fxRate || 1);
  return (
    <>
      <div className="num mt-6 text-[28px] leading-none sm:text-[34px]">{usd(exposureUsd || 0, 0)}</div>
      <div className={`mt-2 text-[14px] ${SUBTLE.lime}`}>
        over {costs.months} month{costs.months === 1 ? "" : "s"}
        {wtiPrice ? ` ≈ ${num(exposureUsd / wtiPrice, 2)} WTI` : ""}
      </div>
      <p className={`mt-6 text-[14px] leading-relaxed ${SUBTLE.lime}`}>
        Monthly fuel bill ≈ {costs.currency} {num(monthly || 0, 0)} (≈ {usd(monthly / (costs.fxRate || 1) || 0, 0)}). Locke hedges the {costs.crudeSharePct}% that
        moves with crude.
      </p>
    </>
  );
}
