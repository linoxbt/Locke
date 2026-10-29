"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPublicClient, custom, decodeEventLog, encodeFunctionData, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { BASE_MARKETS, erc20Abi, factoryAbi, USDC, usdcUnits, type BasePlanType } from "@/lib/base/contracts";
import { providerFor, rememberedKind, sendBaseCalls, walletErrorMessage, walletFor } from "@/lib/base/wallet";
import { BasePlanError, sizeBasePlan, type BasePlanInputs, type BaseSizing, type MarketTerms } from "@/lib/domain/basePlans";
import { usd } from "@/lib/ui/format";
import { Field, Segmented, Slider } from "../form";
import { Button, Card, ErrorNote, inputCls, Notice, Stat } from "../ui";

interface MarketInfo {
  pairIndex: number;
  symbol: string;
  asset: string;
  type: BasePlanType;
  buy: boolean;
  label: string;
  available: boolean;
  marketOpen: boolean;
  price: number | null;
  terms: MarketTerms | null;
  carryPctPerHour: number | null;
}

type Step = "idle" | "wallet" | "confirming" | "recording";

/**
 * New Locke vault: pick what to protect, see the size and the deposit, then one wallet batch
 * approves the USDC and creates the vault (owned by this account) with its limits and deposit.
 */
export function NewVaultForm({ address, factory, dataSuffix }: { address: string; factory: Address; dataSuffix?: Hex }) {
  const router = useRouter();
  const [markets, setMarkets] = useState<MarketInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [type, setType] = useState<BasePlanType>("holdings");
  const [pairIndex, setPairIndex] = useState<number>(0);
  const [valueUsd, setValueUsd] = useState(1000);
  const [sharePct, setSharePct] = useState(50);
  const [monthlySpendUsd, setMonthlySpendUsd] = useState(500);
  const [months, setMonths] = useState(3);
  const [crudeSharePct, setCrudeSharePct] = useState(60);
  const [leverage, setLeverage] = useState(2);
  const [bufferPct, setBufferPct] = useState(50);
  const [agreed, setAgreed] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/base/markets", { cache: "no-store" })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({})))?.error ?? "Avantis is unavailable"))))
      .then((d) => setMarkets(d.markets))
      .catch((e) => setLoadError(String(e.message ?? e)));
  }, []);

  const choices = BASE_MARKETS.filter((m) => m.type === type);
  const market = markets?.find((m) => m.pairIndex === pairIndex);
  const inputs: BasePlanInputs =
    type === "holdings"
      ? { type, pairIndex, valueUsd, sharePct, leverage, bufferPct }
      : { type, pairIndex, monthlySpendUsd, months, crudeSharePct, leverage, bufferPct };

  const sized = useMemo((): { sizing: BaseSizing | null; problem: string | null } => {
    if (!market?.terms) return { sizing: null, problem: null };
    try {
      return { sizing: sizeBasePlan(inputs, market.terms), problem: null };
    } catch (e) {
      return { sizing: null, problem: e instanceof BasePlanError ? e.message : String(e) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, type, pairIndex, valueUsd, sharePct, monthlySpendUsd, months, crudeSharePct, leverage, bufferPct]);

  function pickType(t: BasePlanType) {
    setType(t);
    setPairIndex(BASE_MARKETS.find((m) => m.type === t)!.pairIndex);
  }

  async function create() {
    const sizing = sized.sizing;
    if (!sizing) return;
    setError(null);
    setStep("wallet");
    try {
      const wallet = await walletFor(address, dataSuffix);
      const reader = createPublicClient({ chain: base, transport: custom(await providerFor(rememberedKind())) });
      const deposit = usdcUnits(sizing.depositUsd);
      const balance = await reader.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [wallet.account.address] });
      if (balance < deposit) throw new Error(`This account holds ${usd(Number(balance) / 1e6)} of USDC on Base; the plan needs ${usd(sizing.depositUsd)}.`);

      const plan = {
        enabled: true,
        buy: sizing.buy,
        maxLeverage: BigInt(Math.round(sizing.limits.maxLeverage * 1e10)),
        maxNotional: usdcUnits(sizing.limits.maxNotionalUsd),
      };
      const receipts = await sendBaseCalls(wallet, [
        { to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [factory, deposit] }) },
        { to: factory, data: encodeFunctionData({ abi: factoryAbi, functionName: "createVault", args: [BigInt(pairIndex), plan, deposit] }) },
      ]);
      setStep("confirming");
      let vault: string | null = null;
      let txHash: string | null = null;
      for (const r of receipts) {
        for (const log of r.logs) {
          if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
          try {
            const ev = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics, eventName: "VaultCreated" });
            vault = ev.args.vault;
            txHash = r.transactionHash;
          } catch {
            /* another factory event */
          }
        }
      }
      if (!vault || !txHash) throw new Error("The vault was created but Locke couldn't read it back. Refresh in a moment.");
      setStep("recording");
      const res = await fetch("/api/base/vaults", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ txHash, inputs }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Couldn't record the vault");
      router.push(`/base/vaults/${vault.toLowerCase()}`);
    } catch (e) {
      setError(walletErrorMessage(e));
      setStep("idle");
    }
  }

  if (loadError) return <Notice tone="danger">Avantis&apos;s market data didn&apos;t load ({loadError}). Try again shortly.</Notice>;

  const busy = step !== "idle";
  const sizing = sized.sizing;
  const hint = {
    wallet: "Approve in your wallet: one request covers the USDC approval and the vault.",
    confirming: "Waiting for Base to confirm…",
    recording: "Saving your vault…",
    idle: "",
  }[step];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <Card className="flex flex-col gap-6">
        <Field label="What to protect" group>
          <Segmented
            label="Plan type"
            value={type}
            onChange={pickType}
            options={[
              { value: "holdings", label: "Crypto the business holds" },
              { value: "costs", label: "Fuel the business buys" },
            ]}
          />
        </Field>

        <Field label="Market" group hint={market?.carryPctPerHour != null ? carryHint(market) : undefined}>
          <Segmented<number>
            label="Market"
            value={pairIndex}
            onChange={setPairIndex}
            options={choices.map((m) => ({ value: m.pairIndex as number, label: m.label }))}
          />
        </Field>

        {type === "holdings" ? (
          <>
            <Field label="Value held (USD)" hint={market?.price ? `${market.asset} is ${usd(market.price)} now.` : undefined}>
              <input className={inputCls} inputMode="decimal" value={valueUsd} onChange={(e) => setValueUsd(Number(e.target.value) || 0)} />
            </Field>
            <Field label={`Share to protect: ${sharePct}%`} group>
              <Slider label="Share to protect" value={sharePct} min={10} max={100} step={5} onChange={setSharePct} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Fuel bought each month (USD)">
              <input className={inputCls} inputMode="decimal" value={monthlySpendUsd} onChange={(e) => setMonthlySpendUsd(Number(e.target.value) || 0)} />
            </Field>
            <Field label={`Months to cover: ${months}`} group>
              <Slider label="Months" value={months} min={1} max={6} onChange={setMonths} />
            </Field>
            <Field label={`Share of the fuel price that follows crude: ${crudeSharePct}%`} group hint="Pump prices move with crude for part of their cost; taxes, margins and transport don't.">
              <Slider label="Crude share" value={crudeSharePct} min={10} max={100} step={5} onChange={setCrudeSharePct} />
            </Field>
          </>
        )}

        <Field label={`Leverage: ${leverage}x`} group hint="Lower leverage needs a bigger deposit and sits further from liquidation.">
          <Slider label="Leverage" value={leverage} min={1} max={3} step={0.5} onChange={setLeverage} />
        </Field>
        <Field label={`Buffer kept in the vault: ${bufferPct}%`} group hint="Idle USDC the keeper uses to add margin if prices move against the hedge.">
          <Slider label="Buffer" value={bufferPct} min={10} max={100} step={5} onChange={setBufferPct} />
        </Field>
      </Card>

      <Card tone="ink" className="flex h-fit flex-col gap-5 lg:sticky lg:top-24">
        <div className="eyebrow text-lime">Your vault</div>
        {!markets && <p className="text-[14px] text-paper/70">Loading Avantis&apos;s markets…</p>}
        {sized.problem && <p className="text-[14px] text-paper">{sized.problem}</p>}
        {market && !market.available && <p className="text-[14px] text-paper">This market isn&apos;t available on Avantis right now.</p>}
        {sizing && (
          <>
            <div>
              <div className="text-[13px] text-paper/55">Deposit</div>
              <div className="num display mt-1 text-[36px]">{usd(sizing.depositUsd)}</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Stat subtle="text-paper/55" label="Hedge" value={`${sizing.buy ? "Long" : "Short"} ${usd(sizing.notionalUsd)}`} />
              <Stat subtle="text-paper/55" label="Margin" value={usd(sizing.collateralUsd)} />
              <Stat subtle="text-paper/55" label="Buffer" value={usd(sizing.bufferUsd)} />
              <Stat subtle="text-paper/55" label="Trading fees" value={usd(sizing.feesUsd)} />
            </div>
            <p className="text-[12px] leading-relaxed text-paper/55">
              On-chain limits: Locke&apos;s keeper can never go above {sizing.limits.maxLeverage}x or {usd(sizing.limits.maxNotionalUsd)} of hedge, and can never withdraw. You can withdraw or close at any time.
            </p>
            <label className="flex items-start gap-3 text-[13px] text-paper/85">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#d6f36b]" />
              <span>
                I understand the hedge is a leveraged position on Avantis, can lose its margin if prices move far against it, and that fees and
                funding apply. I&apos;ve read the{" "}
                <Link href="/legal/risk" target="_blank" className="underline underline-offset-2">
                  Risk Disclosure
                </Link>{" "}
                and accept the{" "}
                <Link href="/legal/terms" target="_blank" className="underline underline-offset-2">
                  Terms
                </Link>
                .
              </span>
            </label>
            <Button size="lg" variant="paper" onClick={create} busy={busy} disabled={!agreed || !market?.available}>
              Create vault and deposit {usd(sizing.depositUsd)}
            </Button>
            {hint && <p className="text-[12px] text-paper/70">{hint}</p>}
          </>
        )}
        {error && (
          <div className="rounded-2xl bg-paper p-1">
            <ErrorNote error={error} />
          </div>
        )}
      </Card>
    </div>
  );
}

function carryHint(m: MarketInfo): string {
  const yearly = (m.carryPctPerHour ?? 0) * 24 * 365;
  if (Math.abs(yearly) < 0.05) return `${m.symbol} on Avantis. Holding costs almost nothing right now.`;
  return yearly < 0
    ? `${m.symbol} on Avantis. This side is being paid about ${(-yearly).toFixed(1)}% a year right now.`
    : `${m.symbol} on Avantis. Holding costs about ${yearly.toFixed(1)}% a year right now.`;
}
