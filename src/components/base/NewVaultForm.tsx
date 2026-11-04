"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPublicClient, custom, decodeEventLog, encodeFunctionData, type Address, type Hex, type TransactionReceipt } from "viem";
import { base } from "viem/chains";
import { BASE_MARKETS, erc20Abi, factoryAbi, USDC, usdcUnits, type BasePlanType } from "@/lib/base/contracts";
import { providerFor, rememberedKind, sendBaseCalls, StillPendingError, waitForSent, walletErrorMessage, walletFor, type SentRef } from "@/lib/base/wallet";
import { BasePlanError, parseBaseInputs, sizeBasePlan, type BasePlanInputs, type BaseSizing, type MarketTerms } from "@/lib/domain/basePlans";
import { usd } from "@/lib/ui/format";
import { CREATE_STEPS, Crumbs } from "../Crumbs";
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

type Step = "idle" | "wallet" | "confirming" | "pending" | "recording";

/**
 * A plan sent to Base and not yet saved to Locke: while Base hasn't confirmed it (`sent`, no
 * txHash), or once it has and saving is still to do. Kept in this browser so a reload or a slow
 * confirmation never leads to creating the plan twice.
 */
interface Created {
  txHash: string | null;
  vault: string | null;
  inputs: BasePlanInputs;
  sent?: SentRef;
}
const createdKey = (address: string) => `locke.base.created.${address.toLowerCase()}`;
function loadCreated(address: string): Created | null {
  try {
    const raw = localStorage.getItem(createdKey(address));
    return raw ? (JSON.parse(raw) as Created) : null;
  } catch {
    return null;
  }
}
function storeCreated(address: string, c: Created | null) {
  try {
    if (c) localStorage.setItem(createdKey(address), JSON.stringify(c));
    else localStorage.removeItem(createdKey(address));
  } catch {
    /* private mode: kept until the page closes; Locke also finds unsaved plans from Base itself */
  }
}

/**
 * Describe what to protect and see the plan sized live, then one wallet batch approves the USDC
 * and creates the plan's vault (owned by this account) with its limits and deposit. With no factory yet (before launch) it
 * previews only: everything but creating the plan works, and Locke's fee isn't known yet.
 */
export function NewVaultForm({
  trail = false,
  type: fixedType,
  address,
  factory,
  dataSuffix,
  feeBps,
}: {
  /** Show the Protect · Describe · Preview · Fund trail (and the way back) above the form, following its state. */
  trail?: boolean;
  /** The plan type chosen on /protect; the form then asks only about that one. */
  type?: BasePlanType;
  address: string;
  factory: Address | null;
  dataSuffix?: Hex;
  feeBps: number | null;
}) {
  const router = useRouter();
  const [markets, setMarkets] = useState<MarketInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [type, setType] = useState<BasePlanType>(fixedType ?? "holdings");
  const [pairIndex, setPairIndex] = useState<number>(BASE_MARKETS.find((m) => m.type === (fixedType ?? "holdings"))!.pairIndex);
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
  // Once the vault exists on Base the form never offers to create another: it only retries saving.
  const [created, setCreated] = useState<Created | null>(null);
  useEffect(() => setCreated(loadCreated(address)), [address]);

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
      : {
          type,
          pairIndex,
          monthlySpendUsd,
          months,
          crudeSharePct,
          leverage,
          bufferPct,
        };

  const sized = useMemo((): {
    sizing: BaseSizing | null;
    problem: string | null;
  } => {
    if (!market?.terms) return { sizing: null, problem: null };
    try {
      return { sizing: sizeBasePlan(inputs, market.terms), problem: null };
    } catch (e) {
      return {
        sizing: null,
        problem: e instanceof BasePlanError ? e.message : String(e),
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, type, pairIndex, valueUsd, sharePct, monthlySpendUsd, months, crudeSharePct, leverage, bufferPct]);

  /** Locke's fee on this hedge, charged once it opens (at most once a month per market). */
  const lockeFee = (z: BaseSizing) => Math.ceil(((z.notionalUsd * (feeBps ?? 0)) / 10_000) * 100) / 100;
  /** What the vault needs: the plan's deposit plus Locke's fee, so the fee never eats the buffer. */
  const totalDeposit = (z: BaseSizing) => Math.round((z.depositUsd + lockeFee(z)) * 100) / 100;

  function pickType(t: BasePlanType) {
    setType(t);
    setPairIndex(BASE_MARKETS.find((m) => m.type === t)!.pairIndex);
  }

  /** Save a created vault to Locke; on failure the vault stays on Base and saving can be retried. */
  async function record(c: Created) {
    if (!c.txHash) return;
    setError(null);
    setStep("recording");
    try {
      const res = await fetch("/api/base/vaults", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ txHash: c.txHash, inputs: c.inputs }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Couldn't save the vault to Locke");
      storeCreated(address, null);
      router.push(`/plans/${String(body.address ?? c.vault).toLowerCase()}`);
    } catch (e) {
      setError(walletErrorMessage(e));
      setStep("idle");
    }
  }

  async function create() {
    const sizing = sized.sizing;
    if (!sizing || created || !factory || feeBps == null) return;
    const depositUsd = totalDeposit(sizing);
    setError(null);
    // The server records only inputs it accepts; check them before anything is sent on chain.
    try {
      parseBaseInputs(inputs);
    } catch (e) {
      setError(e instanceof BasePlanError ? e.message : String(e));
      return;
    }
    setStep("wallet");
    try {
      const wallet = await walletFor(address, dataSuffix);
      const reader = createPublicClient({
        chain: base,
        transport: custom(await providerFor(rememberedKind())),
      });
      const deposit = usdcUnits(depositUsd);
      const balance = await reader.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet.account.address],
      });
      if (balance < deposit) throw new Error(`This account holds ${usd(Number(balance) / 1e6)} of USDC on Base; the plan needs ${usd(depositUsd)}.`);

      const plan = {
        enabled: true,
        buy: sizing.buy,
        maxLeverage: BigInt(Math.round(sizing.limits.maxLeverage * 1e10)),
        maxNotional: usdcUnits(sizing.limits.maxNotionalUsd),
        maxCollateral: usdcUnits(sizing.limits.maxCollateralUsd),
      };
      // Kept for the plan's inputs if this page never gets to save it (Locke finds the vault on Base later).
      await fetch("/api/base/vaults/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs }),
      }).catch(() => null);
      const receipts = await sendBaseCalls(
        wallet,
        [
          {
            to: USDC,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [factory, deposit],
            }),
          },
          {
            to: factory,
            data: encodeFunctionData({
              abi: factoryAbi,
              functionName: "createVault",
              args: [BigInt(pairIndex), plan, deposit],
            }),
          },
        ],
        // From the moment the wallet sends it, the form never offers to create again: it follows this one.
        (sent) => {
          const c: Created = { txHash: null, vault: null, inputs, sent };
          storeCreated(address, c);
          setCreated(c);
          setStep("confirming");
        },
      );
      await landed(receipts, inputs);
    } catch (e) {
      if (e instanceof StillPendingError) {
        setStep("pending");
        return;
      }
      // Sent and failed on Base, or never sent: nothing was created, so the form is free again.
      storeCreated(address, null);
      setCreated(null);
      setError(walletErrorMessage(e));
      setStep("idle");
    }
  }

  /** The creation is on Base: find the new vault in it and save it to Locke. */
  async function landed(receipts: TransactionReceipt[], planInputs: BasePlanInputs) {
    if (!factory) return;
    let vault: string | null = null;
    let txHash: string | null = null;
    for (const r of receipts) {
      for (const log of r.logs) {
        if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
        try {
          const ev = decodeEventLog({
            abi: factoryAbi,
            data: log.data,
            topics: log.topics,
            eventName: "VaultCreated",
          });
          vault = ev.args.vault;
          txHash = r.transactionHash;
        } catch {
          /* another factory event */
        }
      }
    }
    if (!vault || !txHash) {
      storeCreated(address, null);
      setCreated(null);
      setError("The transaction went through, but Locke couldn't find a new plan in it. Check your wallet's activity before trying again.");
      setStep("idle");
      return;
    }
    const saved: Created = { txHash, vault, inputs: planInputs };
    storeCreated(address, saved);
    setCreated(saved);
    await record(saved);
  }

  /** Look again for a creation Base hadn't confirmed (this visit or an earlier one). */
  async function checkAgain(c: Created) {
    if (!c.sent) return;
    setError(null);
    setStep("confirming");
    try {
      const wallet = await walletFor(address, dataSuffix);
      await landed(await waitForSent(wallet, c.sent, 60_000), c.inputs);
    } catch (e) {
      if (e instanceof StillPendingError) return setStep("pending");
      if (/didn't go through/.test(String((e as Error).message))) {
        storeCreated(address, null);
        setCreated(null);
      }
      setError(walletErrorMessage(e));
      setStep("idle");
    }
  }

  if (loadError && !created) return <Notice tone="danger">Avantis&apos;s market data didn&apos;t load ({loadError}). Try again shortly.</Notice>;

  const busy = step !== "idle";
  const sizing = sized.sizing;
  const hint = {
    wallet: "Approve in your wallet: the USDC approval and the plan's vault (one request in Base Account, two in other wallets).",
    confirming: "Waiting for Base to confirm…",
    pending: "",
    recording: "Saving your plan…",
    idle: "",
  }[step];

  // Describing until the plan sizes, previewing once it does, funding once the wallet is involved.
  const trailStep = created || step !== "idle" ? 3 : sized.sizing && agreed ? 2 : 1;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      {trail && (
        <div className="lg:col-span-2">
          <Crumbs steps={CREATE_STEPS} current={trailStep} back={{ href: "/protect", label: "What to protect" }} />
          {!factory && (
            <div className="-mt-2">
              <Notice tone="info">Locke isn&apos;t live yet. You can describe and preview a plan now; creating it opens at launch.</Notice>
            </div>
          )}
        </div>
      )}
      <Card className="flex flex-col gap-6">
        {!fixedType && (
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
        )}

        <Field label="Market" group hint={market?.carryPctPerHour != null ? carryHint(market) : undefined}>
          <Segmented<number>
            label="Market"
            value={pairIndex}
            onChange={setPairIndex}
            options={choices.map((m) => ({
              value: m.pairIndex as number,
              label: m.label,
            }))}
          />
        </Field>

        {type === "holdings" ? (
          <>
            <Field label="Value held (USD)" hint={market?.price ? `${market.asset} is ${usd(market.price)} now.` : undefined}>
              <MoneyInput label="Value held (USD)" value={valueUsd} onChange={setValueUsd} />
            </Field>
            <Field label={`Share to protect: ${sharePct}%`} group>
              <Slider label="Share to protect" value={sharePct} min={10} max={100} step={5} onChange={setSharePct} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Fuel bought each month (USD)">
              <MoneyInput label="Fuel bought each month (USD)" value={monthlySpendUsd} onChange={setMonthlySpendUsd} />
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
        <div className="eyebrow text-lime">Your plan</div>
        {!markets && <p className="text-[14px] text-paper/70">Loading Avantis&apos;s markets…</p>}
        {sized.problem && <p className="text-[14px] text-paper">{sized.problem}</p>}
        {market && !market.available && <p className="text-[14px] text-paper">This market isn&apos;t available on Avantis right now.</p>}
        {sizing && (
          <>
            <div>
              <div className="text-[13px] text-paper/55">Deposit</div>
              <div className="num display mt-1 text-[36px]">{usd(totalDeposit(sizing))}</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Stat subtle="text-paper/55" label="Hedge" value={`${sizing.buy ? "Long" : "Short"} ${usd(sizing.notionalUsd)}`} />
              <Stat subtle="text-paper/55" label="Margin" value={usd(sizing.collateralUsd)} />
              <Stat subtle="text-paper/55" label="Buffer" value={usd(sizing.bufferUsd)} />
              <Stat subtle="text-paper/55" label="Trading fees" value={usd(sizing.feesUsd)} />
              <Stat
                subtle="text-paper/55"
                label="Locke fee"
                value={feeBps == null ? "Set at launch" : feeBps ? usd(lockeFee(sizing)) : "None"}
                sub={
                  feeBps == null
                    ? "At most 0.20% of the hedge, shown before you create the plan"
                    : feeBps
                      ? `${(feeBps / 100).toFixed(2)}% of the hedge, once it opens; at most once a month per market`
                      : undefined
                }
              />
            </div>
            <p className="text-[12px] leading-relaxed text-paper/55">
              On-chain limits: Locke&apos;s keeper can never go above {sizing.limits.maxLeverage}x, {usd(sizing.limits.maxNotionalUsd)} of hedge or{" "}
              {usd(sizing.limits.maxCollateralUsd)} of margin, and can never withdraw. You can withdraw or close at any time.
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
            {!created && factory && market && !market.available && (
              <p className="text-[13px] text-paper/80">
                Avantis isn&apos;t taking new positions on this market right now, so plans for it can&apos;t be created.
              </p>
            )}
            {!created && factory && market?.available && !market.marketOpen && (
              <p className="text-[13px] text-paper/80">
                The {market.asset} market is closed right now. You can create the plan; Locke opens the hedge when the market reopens, and the plan isn&apos;t
                protected until then.
              </p>
            )}
            {!created && factory && (
              <Button size="lg" variant="paper" onClick={create} busy={busy} disabled={!agreed || !market?.available}>
                Create plan and deposit {usd(totalDeposit(sizing))}
              </Button>
            )}
            {!factory && (
              <Button size="lg" variant="paper" disabled>
                Creating plans opens at launch
              </Button>
            )}
            {hint && <p className="text-[12px] text-paper/70">{hint}</p>}
          </>
        )}
        {created && !created.txHash && (
          <div className="flex flex-col gap-3 rounded-2xl bg-paper/10 p-4">
            <p className="text-[14px] text-paper">
              {step === "confirming"
                ? "Your plan is on its way to Base. Waiting for it to confirm…"
                : "Your plan was sent to Base and isn't confirmed yet. Don't create it again: it may still go through. Check your wallet's activity, then check again here."}
            </p>
            {step !== "confirming" && step !== "recording" && (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="paper" onClick={() => checkAgain(created)}>
                  Check again
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    // Only once the owner has seen in their wallet that it didn't go through.
                    if (!window.confirm("Only do this if your wallet shows the plan was never created. Start over?")) return;
                    storeCreated(address, null);
                    setCreated(null);
                    setStep("idle");
                  }}
                >
                  It didn&apos;t go through
                </Button>
              </div>
            )}
          </div>
        )}
        {created && created.txHash && (
          <div className="flex flex-col gap-3 rounded-2xl bg-paper/10 p-4">
            <p className="text-[14px] text-paper">
              Your plan&apos;s vault is created on Base
              {created.vault && (
                <>
                  {" "}
                  (
                  <a href={`https://basescan.org/address/${created.vault}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    view it
                  </a>
                  )
                </>
              )}
              . {step !== "idle" ? "Saving it to Locke…" : "Saving it to Locke didn't finish; your USDC is safe in it."}
            </p>
            {step === "idle" && (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="paper" onClick={() => record(created)} busy={busy}>
                  Retry saving
                </Button>
                {/* The portfolio saves it too: it looks on Base for plans this account created. */}
                <Button
                  variant="ghost"
                  onClick={() => {
                    storeCreated(address, null);
                    router.push("/portfolio");
                  }}
                >
                  Go to my plans
                </Button>
              </div>
            )}
          </div>
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

/**
 * A dollar amount typed as text: commas, spaces and a leading $ are fine, a half-typed "1." stays
 * as typed, and anything that isn't a number is flagged rather than read as 0.
 */
function MoneyInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const parsed = Number(text.replace(/[\s,$]/g, ""));
  const bad = text.trim() === "" || !Number.isFinite(parsed) || parsed < 0;
  return (
    <>
      <input
        className={inputCls}
        inputMode="decimal"
        aria-label={label}
        aria-invalid={bad}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value.replace(/[\s,$]/g, ""));
          // Not a number: the plan can't be sized (and so can't be created) until it is one.
          onChange(e.target.value.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : Number.NaN);
        }}
      />
      {bad && <span className="mt-1 block text-[12px] text-danger-ink">Enter an amount in dollars, like 25,000.</span>}
    </>
  );
}
