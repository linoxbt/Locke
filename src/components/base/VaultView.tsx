"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { encodeFunctionData, zeroAddress, type Address, type Hex } from "viem";
import { proofPath } from "@/lib/base/attest";
import { erc20Abi, USDC, usdcUnits, vaultAbi } from "@/lib/base/contracts";
import { sendBaseCalls, walletErrorMessage, walletFor } from "@/lib/base/wallet";
import { LOCKE_THRESHOLDS } from "@/lib/domain/risk";
import type { VaultView as Detail } from "@/lib/server/baseVaults";
import { pct, price, shortAddr, signedUsd, usd } from "@/lib/ui/format";
import { Ago } from "../Time";
import { Button, Card, Display, ErrorNote, inputCls, Notice, Stat, StateChip } from "../ui";
import { BaseMark } from "./BaseMark";
import { IncomeCard } from "./IncomeCard";

const POLL_MS = 10_000;

type Action = "deposit" | "withdraw" | "close" | "keeper";

/** A Locke vault on Base for its owner: the hedge, its risk, and every exit, live. */
export function VaultView({ initial, dataSuffix, factoryKeeper }: { initial: Detail; dataSuffix?: Hex; factoryKeeper: string | null }) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  // Live updates that stopped: say so rather than show old figures as current.
  const [stale, setStale] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/base/vaults/${d.address}`, { cache: "no-store" });
      if (r.status === 401) return window.location.assign(`/base?next=${encodeURIComponent(window.location.pathname)}`);
      if (!r.ok) throw new Error(String(r.status));
      setD(await r.json());
      setStale(false);
    } catch {
      setStale(true);
    }
  }, [d.address]);

  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const vault = d.address as Address;
  const owner = d.chain?.owner ?? "";
  const keeperOn = !!d.chain && d.chain.keeper !== zeroAddress;

  async function run(action: Action, build: (from: Address) => { to: Address; data: Hex }[], message: string) {
    setBusy(action);
    setError(null);
    setDone(null);
    try {
      const wallet = await walletFor(owner, dataSuffix);
      await sendBaseCalls(wallet, build(wallet.account.address));
      // Show the new balances before saying it worked.
      await refresh();
      setAmount("");
      setDone(message);
    } catch (e) {
      setError(walletErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const amt = Number(amount);
  const amountOk = Number.isFinite(amt) && amt > 0;

  const deposit = () =>
    run(
      "deposit",
      () => [
        { to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault, usdcUnits(amt)] }) },
        { to: vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [usdcUnits(amt)] }) },
      ],
      `Deposited ${usd(amt)}.`
    );
  const withdraw = () =>
    run(
      "withdraw",
      (from) => [{ to: vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "withdraw", args: [from, usdcUnits(amt)] }) }],
      `Withdrew ${usd(amt)} to your account.`
    );
  const close = () =>
    d.position &&
    run(
      "close",
      () => [
        {
          to: vault,
          data: encodeFunctionData({
            abi: vaultAbi,
            functionName: "ownerClose",
            args: [BigInt(d.pairIndex), BigInt(d.position!.index), usdcUnits(d.position!.collateralUsd), BigInt(Math.round((d.mark ?? 0) * 1e10))],
          }),
        },
      ],
      "Close sent. Avantis fills it within a few seconds and the USDC comes back to the vault."
    );
  const toggleKeeper = () =>
    run(
      "keeper",
      () => [{ to: vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "setKeeper", args: [(keeperOn ? zeroAddress : factoryKeeper) as Address] }) }],
      keeperOn ? "Locke's keeper is removed. Nothing will trade this vault until you add it back." : "Locke's keeper is back and watching this vault."
    );

  const p = d.position;
  const ratio = p?.ratio ?? null;
  const level = ratio == null ? "ok" : ratio >= LOCKE_THRESHOLDS.action ? "action" : ratio >= LOCKE_THRESHOLDS.watch ? "watch" : "ok";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Display lead={d.name} rest={`on ${d.symbol}`} />
          <a href={`https://basescan.org/address/${d.address}`} target="_blank" rel="noreferrer" className="num mt-2 inline-block text-[13px] text-ink-3 hover:text-ink">
            Vault {shortAddr(d.address)} on BaseScan
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {d.attestation && (
            <Link
              href={proofPath(d.attestation)}
              className="inline-flex h-8 items-center gap-2 rounded-full bg-ink px-3 text-[13px] text-paper transition-colors hover:bg-ink/85"
            >
              <BaseMark size={10} /> Protected by Locke · proof
            </Link>
          )}
          <StateChip status={d.status} level={level === "ok" ? undefined : level} />
        </div>
      </div>

      {stale && <Notice>Live updates paused: Locke couldn&apos;t refresh this vault. The figures below may be out of date; it keeps trying.</Notice>}
      {d.partial.length > 0 && <Notice>Some live data didn&apos;t load ({d.partial.join(", ")}). Showing what&apos;s available; it retries every few seconds.</Notice>}
      {d.chain?.paused && <Notice>Locke has paused new deposits and new hedges. Withdrawals and closes still work.</Notice>}
      {d.statusNote && <Notice tone="info">{d.statusNote}</Notice>}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="flex flex-col gap-6">
          <div className="eyebrow">The hedge on Avantis</div>
          {p ? (
            <>
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
                <Stat label="Position" value={`${p.buy ? "Long" : "Short"} ${usd(p.collateralUsd * p.leverage)}`} sub={`${p.leverage.toFixed(2)}x on ${usd(p.collateralUsd)} margin`} />
                <Stat label="Entry → mark" value={`${price(p.openPrice)} → ${price(d.mark)}`} />
                <Stat label="Hedge P&L (after fees)" value={signedUsd(p.pnlUsd)} tone={p.pnlUsd >= 0 ? "ok" : "bad"} sub="Offsets the move in what you protect" />
                <Stat label="Liquidation price" value={price(p.liquidationPrice)} />
                <Stat label="Funding" value={signedUsd(-p.fundingFeeUsd)} sub={p.fundingFeeUsd <= 0 ? "Paid to this hedge" : "Paid by this hedge"} />
                <Stat label="Margin used" value={pct(ratio)} sub="Liquidation at 100%" />
              </div>
              <RatioBar ratio={ratio} />
            </>
          ) : (
            <p className="text-[14px] leading-relaxed text-ink-2">
              {d.status === "closed"
                ? "No open hedge. The vault's USDC is yours to withdraw."
                : d.marketOpen === false
                  ? `The ${d.symbol} market is closed right now. Locke's keeper opens the hedge when it reopens.`
                  : keeperOn
                    ? "Locke's keeper opens the hedge shortly after the deposit lands. Avantis fills it within seconds."
                    : "No open hedge, and Locke's keeper is removed, so none will be opened."}
            </p>
          )}

          <div className="border-t border-line pt-5">
            <div className="eyebrow mb-3">Activity</div>
            <ul className="flex flex-col gap-2 text-[13px]">
              {d.events.length === 0 && <li className="text-ink-3">Nothing yet.</li>}
              {d.events.map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-4">
                  <span className={e.level === "action" ? "text-danger-ink" : "text-ink"}>
                    {e.message}
                    {e.txHash && (
                      <a href={`https://basescan.org/tx/${e.txHash}`} target="_blank" rel="noreferrer" className="ml-2 text-ink-3 hover:text-ink">
                        tx
                      </a>
                    )}
                  </span>
                  <span className="num shrink-0 text-ink-3">
                    <Ago iso={e.at} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card tone="mist" className="flex h-fit flex-col gap-5">
          <div className="eyebrow">Your money</div>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Idle in the vault" value={usd(d.chain?.idleUsd)} />
            <Stat label="In the hedge" value={usd(p?.collateralUsd ?? 0)} />
            {d.chain && (
              <Stat
                label="Locke fee"
                value={d.chain.feeBps ? `${(d.chain.feeBps / 100).toFixed(2)}%` : "None"}
                sub={d.chain.feeBps ? "Of the hedge, once it opens; at most monthly per market" : undefined}
              />
            )}
          </div>
          <label className="block">
            <span className="mb-2 block text-sm text-ink-2">Amount (USDC)</span>
            <input className={inputCls} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={deposit} busy={busy === "deposit"} disabled={!amountOk || busy !== null || d.chain?.paused}>
              Deposit
            </Button>
            <Button variant="ghost" onClick={withdraw} busy={busy === "withdraw"} disabled={!amountOk || busy !== null || amt > (d.chain?.idleUsd ?? 0)}>
              Withdraw
            </Button>
          </div>
          {amountOk && amt > (d.chain?.idleUsd ?? 0) && <p className="text-[12px] text-ink-2">You can withdraw up to {usd(d.chain?.idleUsd)} now. Close the hedge to free the rest.</p>}

          <div className="flex flex-col gap-2 border-t border-line pt-5">
            {p && (
              <Button variant="danger" onClick={close} busy={busy === "close"} disabled={busy !== null || d.mark == null}>
                {d.mark == null ? "Waiting for a price to close" : "Close the hedge now"}
              </Button>
            )}
            <Button variant="ghost" onClick={toggleKeeper} busy={busy === "keeper"} disabled={busy !== null || (!keeperOn && !factoryKeeper)}>
              {keeperOn ? "Remove Locke's keeper" : "Add Locke's keeper back"}
            </Button>
            <p className="text-[12px] leading-relaxed text-ink-3">
              These go straight from your wallet to the vault. Locke can&apos;t block them, and they work even if Locke is offline.
            </p>
          </div>
          {done && <Notice tone="info">{done}</Notice>}
          <ErrorNote error={error} />
        </Card>
      </div>

      {(d.status !== "closed" || d.income?.status === "on") && owner && (
        <IncomeCard vault={d.address} owner={owner} income={d.income} closed={d.status === "closed"} dataSuffix={dataSuffix} onChange={refresh} />
      )}
    </div>
  );
}

function RatioBar({ ratio }: { ratio: number | null }) {
  const r = ratio == null ? 0 : Math.min(1, Math.max(0, ratio));
  const fill = r >= LOCKE_THRESHOLDS.action ? "bg-danger" : r >= LOCKE_THRESHOLDS.watch ? "bg-watch" : "bg-ink";
  return (
    <div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-mist" role="meter" aria-label="Margin used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r * 100)}>
        <div className={`h-full rounded-full ${fill} transition-[width] duration-700`} style={{ width: `${Math.max(2, r * 100)}%` }} />
        {[LOCKE_THRESHOLDS.watch, LOCKE_THRESHOLDS.action].map((t) => (
          <span key={t} className="absolute top-0 h-full w-0.5 bg-paper" style={{ left: `${t * 100}%` }} />
        ))}
      </div>
      <div className="num mt-1 flex justify-between text-[11px] text-ink-3">
        <span>Healthy</span>
        <span>
          Keeper adds margin at {Math.round(LOCKE_THRESHOLDS.action * 100)}% · Liquidation 100%
        </span>
      </div>
    </div>
  );
}
