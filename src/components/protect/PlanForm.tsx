"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Field, Segmented, Slider } from "../form";
import { Arrow, Button, Card, Display, ErrorNote, Eyebrow, inputCls, SUBTLE } from "../ui";
import { useWallet } from "../WalletProvider";
import { walletAda } from "@/lib/cardano/wallet";
import {
  budgetCover,
  calibratedCrudeShare,
  COUNTRIES,
  crudeCostPerLitre,
  FUELS,
  fxBillImpact,
  pctChange,
  PUMP_PRICES,
  PUMP_SOURCE,
  type CountryCode,
  type FuelType,
} from "@/lib/domain/fuel";
import type { CostsInputs, HoldingsInputs, PlanType } from "@/lib/domain/types";
import type { FuelContext } from "@/lib/server/fuelContext";
import { api, errorMessage } from "@/lib/ui/api";
import { num, usd } from "@/lib/ui/format";

const DEFAULT_HOLDINGS: HoldingsInputs = { asset: "ADA", amountHeld: 0, sharePct: 60, leverage: 1, bufferPct: 25 };
const DEFAULT_COSTS: CostsInputs = {
  fuelType: "diesel",
  country: "NG",
  litresPerMonth: 2000,
  pumpPrice: PUMP_PRICES.NG.diesel!.price,
  fxRate: 1530,
  currency: "NGN",
  months: 3,
  crudeSharePct: 45,
  coverPct: 100,
  leverage: 1,
  bufferPct: 25,
};

/** Form-only state for the costs plan: how the crude share and the hedge size are chosen. */
interface CostsUi {
  shareMode: "calibrated" | "custom";
  mode: "full" | "budget";
  monthlyMax: number;
  stressPct: number;
}

/** Describe step for one plan type. Submitting creates a draft and opens its preview page. */
export function PlanForm({ type, adaPrice, wtiPrice }: { type: PlanType; adaPrice: number | null; wtiPrice: number | null }) {
  const router = useRouter();
  const { ensureWallet, wallet } = useWallet();
  const [holdings, setHoldings] = useState<HoldingsInputs>(DEFAULT_HOLDINGS);
  const [costs, setCosts] = useState<CostsInputs>(DEFAULT_COSTS);
  const [ui, setUi] = useState<CostsUi>({ shareMode: "calibrated", mode: "full", monthlyMax: NaN, stressPct: 50 });
  const [ctx, setCtx] = useState<FuelContext | null>(null);
  const [walletBalance, setWalletBalance] = useState<WalletRead>({ ada: null, busy: false, error: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tone = type === "costs" ? "lime" : "cobalt";

  // A wallet already connected this visit can be read without asking it for anything.
  useEffect(() => {
    if (type !== "holdings" || !wallet) return;
    walletAda(wallet)
      .then((ada) => {
        setWalletBalance({ ada, busy: false, error: null });
        setHoldings((h) => (h.amountHeld ? h : { ...h, amountHeld: ada }));
      })
      .catch(() => {});
  }, [type, wallet]);

  // Otherwise only on a click: wallets refuse (or stack up) access requests nobody asked for.
  const readWallet = async () => {
    setWalletBalance((b) => ({ ...b, busy: true, error: null }));
    try {
      const ada = await walletAda(await ensureWallet());
      setWalletBalance({ ada, busy: false, error: null });
      setHoldings((h) => ({ ...h, amountHeld: ada }));
    } catch (e) {
      setWalletBalance((b) => ({ ...b, busy: false, error: errorMessage(e) }));
    }
  };

  // Live WTI and exchange rates: fill today's rate for the chosen country and calibrate the crude share.
  useEffect(() => {
    if (type !== "costs") return;
    api<FuelContext>("/api/fuel")
      .then((c) => {
        setCtx(c);
        setCosts((x) => {
          const live = x.country ? c.fx?.rates[COUNTRIES[x.country].currency]?.now : undefined;
          return live ? { ...x, fxRate: Math.round(live * 100) / 100 } : x;
        });
      })
      .catch(() => {});
  }, [type]);

  const calibrated = ctx ? calibratedCrudeShare(costs.fuelType, ctx.wti.now, costs.fxRate, costs.pumpPrice) : null;
  useEffect(() => {
    if (ui.shareMode === "calibrated" && calibrated != null && calibrated !== costs.crudeSharePct) {
      setCosts((x) => ({ ...x, crudeSharePct: calibrated }));
    }
  }, [ui.shareMode, calibrated, costs.crudeSharePct]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (type === "costs") {
      if (!(costs.pumpPrice > 0)) return setError("Enter the pump price you pay per litre.");
      // An empty budget would reach the server as no budget, and hedge all of the crude share.
      if (ui.mode === "budget" && !(ui.monthlyMax > 0)) {
        return setError("Enter a monthly budget above zero, or choose “All of the crude share”.");
      }
    }
    setBusy(true);
    try {
      const inputs =
        type === "holdings"
          ? holdings
          : { ...costs, coverPct: 100, budget: ui.mode === "budget" ? { monthlyMax: ui.monthlyMax, stressPct: ui.stressPct } : null };
      const r = await api<{ planId: string }>("/api/plans", { body: { type, inputs } });
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
          {type === "holdings" ? (
            <HoldingsFields v={holdings} set={setHoldings} wallet={walletBalance} onReadWallet={readWallet} />
          ) : (
            <CostsFields v={costs} set={setCosts} ui={ui} setUi={setUi} ctx={ctx} calibrated={calibrated} />
          )}
        </Card>
        <div className="lg:col-span-5">
          <Card tone={tone} className="flex flex-col lg:sticky lg:top-24 lg:min-h-[234px]">
            <Eyebrow className={SUBTLE[tone]}>{type === "holdings" ? "You'll protect" : "Crude-linked spend"}</Eyebrow>
            <Summary type={type} holdings={holdings} costs={costs} ui={ui} ctx={ctx} adaPrice={adaPrice} wtiPrice={wtiPrice} />
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

interface WalletRead {
  ada: number | null;
  busy: boolean;
  error: string | null;
}

function HoldingsFields({
  v,
  set,
  wallet,
  onReadWallet,
}: {
  v: HoldingsInputs;
  set: React.Dispatch<React.SetStateAction<HoldingsInputs>>;
  wallet: WalletRead;
  onReadWallet(): void;
}) {
  return (
    <>
      <Field
        label="ADA your business holds"
        hint={
          <>
            {wallet.error ?? (wallet.ada != null ? `${num(wallet.ada, 0)} ADA in this wallet. Edit to include ADA your treasury holds elsewhere.` : "Type an amount, or read it from your wallet.")}{" "}
            <button type="button" className="text-ink underline underline-offset-4 disabled:opacity-50" disabled={wallet.busy} onClick={onReadWallet}>
              {wallet.busy ? "Reading…" : "Read from wallet"}
            </button>
          </>
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

const money = (cur: string, n: number) => `${cur} ${num(Number.isFinite(n) ? n : 0, n >= 100 ? 0 : 2)}`;

function CostsFields({
  v,
  set,
  ui,
  setUi,
  ctx,
  calibrated,
}: {
  v: CostsInputs;
  set: React.Dispatch<React.SetStateAction<CostsInputs>>;
  ui: CostsUi;
  setUi: React.Dispatch<React.SetStateAction<CostsUi>>;
  ctx: FuelContext | null;
  calibrated: number | null;
}) {
  const ref = v.country ? PUMP_PRICES[v.country][v.fuelType] : undefined;
  const liveFx = v.country ? ctx?.fx?.rates[COUNTRIES[v.country].currency] : undefined;

  // Picking a country or fuel loads its reference pump price, currency and today's rate.
  const choose = (country: CountryCode | undefined, fuel: FuelType) =>
    set((x) => {
      const next: CostsInputs = { ...x, country, fuelType: fuel };
      if (country) {
        const r = PUMP_PRICES[country][fuel];
        next.currency = COUNTRIES[country].currency;
        // No reference: the old number would be read in the new currency, so ask for it instead.
        next.pumpPrice = r ? r.price : NaN;
        const fx = ctx?.fx?.rates[COUNTRIES[country].currency]?.now;
        if (fx) next.fxRate = Math.round(fx * 100) / 100;
      }
      return next;
    });

  const bill = v.litresPerMonth * v.pumpPrice;
  const budget = ui.mode === "budget" && ui.monthlyMax > 0 && v.pumpPrice > 0 ? budgetCover(v, ui.monthlyMax, ui.stressPct) : null;
  const crudeCost = ctx ? crudeCostPerLitre(v.fuelType, ctx.wti.now, v.fxRate) : null;

  return (
    <>
      <Field group label="Where you buy" hint={v.country ? COUNTRIES[v.country].pricing : "Enter your own pump price and exchange rate below."}>
        <Segmented
          label="Country"
          value={v.country ?? "OTHER"}
          onChange={(c) => choose(c === "OTHER" ? undefined : (c as CountryCode), v.fuelType)}
          options={[...(Object.keys(COUNTRIES) as CountryCode[]).map((c) => ({ value: c as string, label: COUNTRIES[c].name })), { value: "OTHER", label: "Other" }]}
        />
      </Field>
      <Field group label="Fuel" hint={FUELS[v.fuelType].note}>
        <Segmented
          label="Fuel"
          value={v.fuelType}
          onChange={(f) => choose(v.country, f)}
          options={(Object.keys(FUELS) as FuelType[]).map((f) => ({ value: f, label: f === "kerosene" ? "Kerosene / jet" : f === "lpg" ? "LPG" : FUELS[f].label }))}
        />
      </Field>
      <Field label={`${FUELS[v.fuelType].short} per month`}>
        <NumberInput value={v.litresPerMonth} min={1} suffix="L" onChange={(n) => set((x) => ({ ...x, litresPerMonth: n }))} />
      </Field>
      <div className="grid grid-cols-[88px_1fr] gap-3 sm:grid-cols-[96px_1fr_1fr]">
        <Field label="Currency">
          <input className={inputCls} maxLength={3} value={v.currency} onChange={(e) => set((x) => ({ ...x, currency: e.target.value.toUpperCase() }))} />
        </Field>
        <Field
          label="Pump price per litre"
          hint={
            ref ? (
              <>
                {PUMP_SOURCE.name}, {fmtDay(ref.date)}: {money(v.currency, ref.price)} · 3 mo {signed(pctChange(ref.threeMonthsAgo, ref.price))} · 1 yr{" "}
                {signed(pctChange(ref.yearAgo, ref.price))}
              </>
            ) : v.country ? (
              `No current reference for ${FUELS[v.fuelType].short} in ${COUNTRIES[v.country].name}. Enter what you pay.`
            ) : undefined
          }
        >
          <NumberInput value={v.pumpPrice} min={0} onChange={(n) => set((x) => ({ ...x, pumpPrice: n }))} />
        </Field>
        <div className="col-span-2 sm:col-span-1">
          <Field label={`${v.currency || "Local"} per US dollar`} hint={liveFx && ctx?.fx ? `Live rate ${fmtDay(ctx.fx.date)}: ${num(liveFx.now, 2)}` : undefined}>
            <NumberInput value={v.fxRate} min={0} onChange={(n) => set((x) => ({ ...x, fxRate: n }))} />
          </Field>
        </div>
      </div>
      <Field label={<span className="flex justify-between">Months covered <span className="num text-ink">{v.months}</span></span>}>
        <Slider label="Months covered" min={1} max={6} value={v.months} onChange={(n) => set((x) => ({ ...x, months: n }))} className="text-ink" />
      </Field>
      <Field
        label={
          <span className="flex justify-between">
            Crude share
            <span className="num text-ink">
              {v.crudeSharePct}% <span className="text-ink-3">· {ui.shareMode === "calibrated" && calibrated != null ? "calibrated" : "your setting"}</span>
            </span>
          </span>
        }
        hint={
          <>
            {crudeCost != null && v.pumpPrice > 0
              ? `At today's WTI and rate, crude is ${money(v.currency, crudeCost)} of a ${money(v.currency, v.pumpPrice)} litre. The rest is taxes, refining and distribution.`
              : "The part of the pump price that moves with crude oil."}
            {ui.shareMode === "custom" && calibrated != null && (
              <button type="button" className="ml-1 text-ink underline underline-offset-4" onClick={() => setUi((u) => ({ ...u, shareMode: "calibrated" }))}>
                Use calibrated ({calibrated}%)
              </button>
            )}
          </>
        }
      >
        <Slider
          label="Crude share"
          min={0}
          max={100}
          step={1}
          value={v.crudeSharePct}
          onChange={(n) => {
            setUi((u) => ({ ...u, shareMode: "custom" }));
            set((x) => ({ ...x, crudeSharePct: n }));
          }}
          className="text-ink"
        />
      </Field>
      <Field group label="How much to hedge">
        <Segmented
          label="How much to hedge"
          value={ui.mode}
          onChange={(m) =>
            setUi((u) => ({ ...u, mode: m, monthlyMax: Number.isFinite(u.monthlyMax) ? u.monthlyMax : Math.round((bill * 1.1) / 100) * 100 }))
          }
          options={[
            { value: "full", label: "All of the crude share" },
            { value: "budget", label: "Keep me under a budget" },
          ]}
        />
      </Field>
      {ui.mode === "budget" && (
        <div className="space-y-4 rounded-2xl bg-mist/60 p-4">
          <Field label="Keep my monthly fuel bill under">
            <NumberInput value={ui.monthlyMax} min={0} suffix={v.currency} onChange={(n) => setUi((u) => ({ ...u, monthlyMax: n }))} />
          </Field>
          <Field group label="Even if crude rises">
            <Segmented
              label="Crude rise to protect against"
              value={ui.stressPct}
              onChange={(n) => setUi((u) => ({ ...u, stressPct: n }))}
              options={[25, 50, 100].map((n) => ({ value: n, label: <span className="num">+{n}%</span> }))}
            />
          </Field>
          <p className="text-[13px] leading-relaxed text-ink-2">
            {!budget
              ? v.pumpPrice > 0
                ? "Enter a monthly budget."
                : "Enter your pump price, then a monthly budget."
              : budget.ok
                ? `Locke hedges ${budget.coverPct}% of the crude-linked cost. Today's bill is ${money(v.currency, budget.billNow)}; at crude +${ui.stressPct}% it would be ${money(v.currency, budget.billAtStress)} unhedged and stays under ${money(v.currency, ui.monthlyMax)} with the plan.`
                : budget.reason === "below_today"
                  ? `That's below today's bill of ${money(v.currency, budget.billNow)}. A hedge can't lower today's price.`
                  : `No hedge needed: at crude +${ui.stressPct}% your bill would be ${money(v.currency, budget.billAtStress)}, already under budget.`}
          </p>
        </div>
      )}
      <RiskControls v={v} set={set} />
    </>
  );
}

const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;

/** Exchange-rate warning: recent move of the currency, and what a further fall does to the bill. Not hedgeable on Strike. */
function FxWarning({ c, ctx }: { c: CostsInputs; ctx: FuelContext | null }) {
  const rate = c.country ? ctx?.fx?.rates[COUNTRIES[c.country].currency] : undefined;
  const moved = rate?.ago ? pctChange(rate.ago, rate.now) : null;
  const ref = c.country ? PUMP_PRICES[c.country][c.fuelType] : undefined;
  const wtiMoved = ctx?.wti.ago ? pctChange(ctx.wti.ago, ctx.wti.now) : null;
  const hit = fxBillImpact(c, 10);
  return (
    <div className="mt-6 rounded-xl bg-ink/10 p-3 text-[13px] leading-relaxed text-ink">
      <p className="font-medium">Not covered: the exchange rate</p>
      <p className="mt-1 text-ink/70">
        {moved != null && ctx?.fx
          ? `The ${c.currency} has ${moved > 0 ? "weakened" : "strengthened"} ${Math.abs(moved).toFixed(1)}% against the dollar since ${fmtDay(ctx.fx.agoDate)}. `
          : ""}
        If it weakens another 10%, the crude in your fuel costs more and your bill rises about {money(c.currency, hit)} a month, even if crude doesn&apos;t move. Locke&apos;s hedge only pays when crude rises.
      </p>
      {ref && wtiMoved != null && moved != null && (
        <p className="num mt-2 text-[11px] text-ink/60">
          Last 3 months: {FUELS[c.fuelType].short} {signed(pctChange(ref.threeMonthsAgo, ref.price))} · WTI {signed(wtiMoved)} · {c.currency} vs USD {signed(-moved)}
        </p>
      )}
    </div>
  );
}

function Summary({
  type,
  holdings,
  costs,
  ui,
  ctx,
  adaPrice,
  wtiPrice,
}: {
  type: PlanType;
  holdings: HoldingsInputs;
  costs: CostsInputs;
  ui: CostsUi;
  ctx: FuelContext | null;
  adaPrice: number | null;
  wtiPrice: number | null;
}) {
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
  const budget = ui.mode === "budget" && ui.monthlyMax > 0 && costs.pumpPrice > 0 ? budgetCover(costs, ui.monthlyMax, ui.stressPct) : null;
  const cover = ui.mode === "budget" ? (budget?.ok ? budget.coverPct : 0) : 100;
  const exposureUsd = ((costs.crudeSharePct / 100) * (cover / 100) * monthly * costs.months) / (costs.fxRate || 1);
  return (
    <>
      <div className="num mt-6 text-[28px] leading-none sm:text-[34px]">{usd(exposureUsd || 0, 0)}</div>
      <div className={`mt-2 text-[14px] ${SUBTLE.lime}`}>
        over {costs.months} month{costs.months === 1 ? "" : "s"}
        {wtiPrice ? ` ≈ ${num(exposureUsd / wtiPrice, 2)} WTI` : ""}
      </div>
      <p className={`mt-6 text-[14px] leading-relaxed ${SUBTLE.lime}`}>
        Monthly fuel bill ≈ {costs.currency} {num(monthly || 0, 0)} (≈ {usd(monthly / (costs.fxRate || 1) || 0, 0)}). Locke hedges{" "}
        {cover < 100 ? `${cover}% of ` : ""}the {costs.crudeSharePct}% that moves with crude.
      </p>
      <FxWarning c={costs} ctx={ctx} />
    </>
  );
}
