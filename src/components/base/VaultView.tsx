"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { encodeFunctionData, publicActions, zeroAddress, type Address, type Hex } from "viem";
import { proofPath } from "@/lib/base/attest";
import { erc20Abi, USDC, usdcUnits, vaultAbi } from "@/lib/base/contracts";
import { sendBaseCalls, SentFailedError, StillPendingError, waitForSent, walletErrorMessage, walletFor, type SentRef } from "@/lib/base/wallet";
import { LOCKE_THRESHOLDS } from "@/lib/domain/risk";
import type { VaultView as Detail } from "@/lib/server/baseVaults";
import { readFactoryRoom, roomProblem, type FactoryRoom } from "@/lib/ui/factoryRoom";
import { pct, price, shortAddr, signedUsd, usd } from "@/lib/ui/format";
import { Ago } from "../Time";
import { Button, Card, Display, ErrorNote, inputCls, Notice, Stat, StateChip } from "../ui";
import { BaseMark } from "./BaseMark";
import { IncomeCard } from "./IncomeCard";

const POLL_MS = 10_000;

type Action = "deposit" | "withdraw" | "close" | "keeper";

const ACTION_NOUN: Record<Action, string> = { deposit: "deposit", withdraw: "withdrawal", close: "close", keeper: "keeper change" };

type Wallet = Awaited<ReturnType<typeof walletFor>>;

/** Whose keeper the vault has, as Base says; "unknown" while Base can't be read. */
type KeeperState = "locke" | "none" | "other" | "unknown";

function keeperState(d: Detail, factoryKeeper: string | null): KeeperState {
  if (!d.chain) return "unknown";
  if (/^0x0{40}$/i.test(d.chain.keeper)) return "none";
  if (d.chain.keeperFollowsFactory || (factoryKeeper && d.chain.keeper === factoryKeeper.toLowerCase())) return "locke";
  return "other";
}

/** A Locke vault on Base for its owner: the hedge, its risk, and every exit, live. */
export function VaultView({
  initial,
  viewer,
  dataSuffix,
  factoryKeeper,
  factory = null,
  room = null
}: {
  initial: Detail;
  viewer: string;
  dataSuffix?: Hex;
  factoryKeeper: string | null;
  /** Locke's factory, to check its launch caps again just before a deposit is sent. */
  factory?: Address | null;
  /** The factory's launch caps as read when the page loaded. */
  room?: FactoryRoom | null;
}) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState<Action | null>(null);
  // Sent, but Base hadn't confirmed it in time: it may still land, so the buttons stay off until it's checked.
  const [pending, setPending] = useState<{ action: Action; ref: SentRef; message: string } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  // Live updates that stopped: say so rather than show old figures as current.
  const [stale, setStale] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/base/vaults/${d.address}`, { cache: "no-store" });
      if (r.status === 401) return window.location.assign(`/connect?reconnect=1&next=${encodeURIComponent(window.location.pathname)}`);
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
  const keeper = keeperState(d, factoryKeeper);
  const keeperOn = keeper === "locke";
  // Actions go from the owner's wallet: off while Base can't be read, and for an account that
  // isn't (or no longer is) the vault's owner on Base.
  const isOwner = !!d.chain && owner === viewer.toLowerCase();
  const canAct = isOwner && busy === null && !pending;

  async function run(
    action: Action,
    build: (from: Address) => { to: Address; data: Hex }[],
    message: string,
    precheck?: (wallet: Wallet) => Promise<string | null>
  ) {
    if (!isOwner || pending) return;
    setBusy(action);
    setConfirmClose(false);
    setError(null);
    setDone(null);
    try {
      const wallet = await walletFor(owner, dataSuffix);
      const refusal = await precheck?.(wallet);
      if (refusal) throw new Error(refusal);
      await sendBaseCalls(wallet, build(wallet.account.address));
      // Show the new balances before saying it worked.
      await refresh();
      setAmount("");
      setDone(message);
    } catch (e) {
      // Sent, and Base hasn't confirmed it: never offer to send it again until it's checked.
      if (e instanceof StillPendingError) setPending({ action, ref: e.ref, message });
      else setError(walletErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  /** Look again for an action Base hadn't confirmed. */
  async function checkPending() {
    if (!pending) return;
    setBusy(pending.action);
    setError(null);
    try {
      const wallet = await walletFor(owner, dataSuffix);
      await waitForSent(wallet, pending.ref, 60_000);
      setPending(null);
      await refresh();
      setAmount("");
      setDone(pending.message);
    } catch (e) {
      if (e instanceof SentFailedError) {
        setPending(null);
        setError(walletErrorMessage(e));
      } else if (!(e instanceof StillPendingError)) {
        setError(walletErrorMessage(e));
      }
    } finally {
      setBusy(null);
    }
  }

  const amt = Number(amount);
  const amountOk = Number.isFinite(amt) && amt > 0;
  // A deposit the factory's launch caps would refuse. Owners may still add to a vault while Locke is paused.
  const depositRefusal = room && amountOk ? roomProblem(room, amt, { newPlan: false, vaultUsd: d.chain?.netDepositsUsd ?? 0 }) : null;

  const deposit = () =>
    run(
      "deposit",
      () => [
        { to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault, usdcUnits(amt)] }) },
        { to: vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [usdcUnits(amt)] }) },
      ],
      `Deposited ${usd(amt)}.`,
      // The caps as they are now; if they can't be read, the vault still enforces them.
      async (wallet) =>
        factory
          ? readFactoryRoom(wallet.extend(publicActions), factory)
              .then((r) => roomProblem(r, amt, { newPlan: false, vaultUsd: d.chain?.netDepositsUsd ?? 0 }))
              .catch(() => null)
          : null
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
      "Close sent. Veranta usually fills it within a few seconds, and the USDC comes back to the vault."
    );
  const toggleKeeper = () =>
    run(
      "keeper",
      () => [
        keeperOn
          ? { to: vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "setKeeper", args: [zeroAddress] }) }
          : { to: vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "followFactoryKeeper" }) },
      ],
      keeperOn ? "Locke's keeper is removed. Nothing will trade this vault until you add it back." : "Locke's keeper is back and watching this vault."
    );

  const p = d.position;
  const ratio = p?.ratio ?? null;
  const level = ratio == null ? "ok" : ratio >= LOCKE_THRESHOLDS.action ? "action" : ratio >= LOCKE_THRESHOLDS.watch ? "watch" : "ok";
  // How far the price can move against the hedge before liquidation, as a share of the mark.
  const liqMove = p && d.mark && p.liquidationPrice > 0 ? Math.abs(p.liquidationPrice - d.mark) / d.mark : null;
  // Veranta fills no orders while the market is closed (stocks outside US hours, oil at night and weekends).
  const marketClosed = d.marketOpen === false;

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

      {!d.chain && (
        <Notice tone="danger">
          Base couldn&apos;t be read just now, so the vault&apos;s balances, limits and keeper aren&apos;t shown and the buttons are off. This
          page retries every few seconds; your money is unaffected.
        </Notice>
      )}
      {d.chain && !isOwner && (
        <Notice tone="danger">
          On Base, this vault belongs to {shortAddr(owner)}, not the account you&apos;re signed in with. Only its owner can deposit, withdraw
          or close.
        </Notice>
      )}
      {d.chain?.pendingOwner && isOwner && (
        <Notice>You started handing this vault to {shortAddr(d.chain.pendingOwner)}. It moves to them once they accept on Base.</Notice>
      )}
      {stale && <Notice>Live updates paused: Locke couldn&apos;t refresh this plan. The figures below may be out of date; it keeps trying.</Notice>}
      {d.partial.some((x) => x !== "Base" || d.chain) && <Notice>Some live data didn&apos;t load ({d.partial.join(", ")}). Showing what&apos;s available; it retries every few seconds.</Notice>}
      {d.chain?.paused && <Notice>Locke has paused new hedges and income moves into vaults. Your own deposits, withdrawals and closes still work.</Notice>}
      {d.statusNote && <Notice tone={urgent(d) ? "danger" : "info"}>{d.statusNote}</Notice>}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="flex flex-col gap-6">
          <div className="eyebrow">The hedge on Veranta</div>
          {p ? (
            <>
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
                <Stat label="Position" value={`${p.buy ? "Long" : "Short"} ${usd(p.collateralUsd * p.leverage)}`} sub={`${p.leverage.toFixed(2)}x on ${usd(p.collateralUsd)} margin`} />
                <Stat label="Entry → mark" value={`${price(p.openPrice)} → ${price(d.mark)}`} />
                <Stat label="Hedge P&L (after fees)" value={signedUsd(p.pnlUsd)} tone={p.pnlUsd == null ? undefined : p.pnlUsd >= 0 ? "ok" : "bad"} sub="Offsets the move in what you protect" />
                <Stat label="Liquidation price" value={price(p.liquidationPrice)} />
                <Stat label="Funding" value={signedUsd(-p.fundingFeeUsd)} sub={p.fundingFeeUsd <= 0 ? "Paid to this hedge" : "Paid by this hedge"} />
                <Stat
                  label="Margin used"
                  value={pct(ratio)}
                  sub={liqMove != null && ratio != null && ratio < 1 ? `Liquidation at 100%, a ${pct(liqMove, 1)} price move away` : "Liquidation at 100%"}
                />
              </div>
              <RatioBar ratio={ratio} />
            </>
          ) : (
            <p className="text-[14px] leading-relaxed text-ink-2">
              {d.status === "closed"
                ? "No open hedge. The vault's USDC is yours to withdraw."
                : d.marketOpen === false
                  ? `The ${d.symbol} market is closed right now. Locke's keeper opens the hedge when it reopens.`
                  : keeper === "unknown"
                    ? "No open hedge yet."
                    : keeperOn
                      ? "Locke's keeper opens the hedge shortly after the deposit lands. Veranta fills it within seconds."
                      : keeper === "other"
                        ? "No open hedge. This vault uses a keeper you chose, not Locke's."
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
            <Button onClick={deposit} busy={busy === "deposit"} disabled={!amountOk || !canAct || !!depositRefusal}>
              Deposit
            </Button>
            <Button variant="ghost" onClick={withdraw} busy={busy === "withdraw"} disabled={!amountOk || !canAct || amt > (d.chain?.idleUsd ?? 0)}>
              Withdraw
            </Button>
          </div>
          {amountOk && d.chain && amt > d.chain.idleUsd && <p className="text-[12px] text-ink-2">You can withdraw up to {usd(d.chain?.idleUsd)} now. Close the hedge to free the rest.</p>}
          {depositRefusal && <p className="text-[12px] text-ink-2">{depositRefusal}</p>}

          <div className="flex flex-col gap-2 border-t border-line pt-5">
            {p && !confirmClose && (
              <Button variant="danger" onClick={() => setConfirmClose(true)} busy={busy === "close"} disabled={!canAct || d.mark == null || marketClosed}>
                {d.mark == null ? "Waiting for a price to close" : marketClosed ? "Market closed: close when it reopens" : "Close the hedge now"}
              </Button>
            )}
            {p && marketClosed && (
              <p className="text-[12px] leading-relaxed text-ink-2">
                The {d.symbol} market is closed right now, so Veranta can&apos;t fill a close until it reopens. You can still withdraw the vault&apos;s idle
                USDC.
              </p>
            )}
            {p && confirmClose && (
              <div className="flex flex-col gap-2 rounded-xl bg-paper p-3">
                <p className="text-[13px] leading-relaxed text-ink-2">
                  Closing ends the protection: the hedge is sold at the market price and its margin, plus or minus its P&amp;L, comes back to the
                  vault. Locke&apos;s keeper won&apos;t reopen it on its own.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="danger" onClick={close} busy={busy === "close"} disabled={!canAct || d.mark == null || marketClosed}>
                    Yes, close it
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmClose(false)} disabled={busy !== null}>
                    Keep it open
                  </Button>
                </div>
              </div>
            )}
            {keeper !== "unknown" && (
              <Button variant="ghost" onClick={toggleKeeper} busy={busy === "keeper"} disabled={!canAct}>
                {keeperOn ? "Remove Locke's keeper" : keeper === "other" ? "Use Locke's keeper instead" : "Add Locke's keeper back"}
              </Button>
            )}
            <p className="text-[12px] leading-relaxed text-ink-3">
              These go straight from your wallet to the vault. Locke can&apos;t block them, and they work even if Locke is offline.
            </p>
          </div>
          {pending && (
            <div className="flex flex-col gap-2 rounded-xl bg-paper p-3">
              <p className="text-[13px] leading-relaxed text-ink-2">
                Your {ACTION_NOUN[pending.action]} was sent and Base hasn&apos;t confirmed it yet. Don&apos;t send it again: it may still go through.
                Check your wallet&apos;s activity, then check again here.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={checkPending} busy={busy !== null}>
                  Check again
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => {
                    // Only once the owner has seen in their wallet that it didn't go through.
                    const ask = `Only do this if your wallet shows the ${ACTION_NOUN[pending.action]} never went through. Unlock the buttons?`;
                    if (window.confirm(ask)) setPending(null);
                  }}
                >
                  It didn&apos;t go through
                </Button>
              </div>
            </div>
          )}
          {done && <Notice tone="info">{done}</Notice>}
          <ErrorNote error={error} />
        </Card>
      </div>

      {(d.status !== "closed" || d.income?.status === "on") && isOwner && (
        <IncomeCard vault={d.address} owner={owner} income={d.income} closed={d.status === "closed"} dataSuffix={dataSuffix} onChange={refresh} />
      )}
    </div>
  );
}

/** A note that needs the owner (thin margin, a failing keeper, a removed keeper), not just news. */
function urgent(d: Detail): boolean {
  const n = d.statusNote ?? "";
  return (d.riskLevel !== "ok" && d.riskLevel !== "watch") || /^Margin is getting thin|^Locke couldn't act|keeper is removed/.test(n);
}

function RatioBar({ ratio }: { ratio: number | null }) {
  const r = ratio == null ? 0 : Math.min(1, Math.max(0, ratio));
  const fill = r >= LOCKE_THRESHOLDS.action ? "bg-danger" : r >= LOCKE_THRESHOLDS.watch ? "bg-watch" : "bg-ink";
  return (
    <div>
      <div
        className="relative h-3 w-full overflow-hidden rounded-full bg-mist"
        role="meter"
        aria-label="Margin used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(r * 100)}
        aria-valuetext={
          ratio == null
            ? "Not known yet"
            : `${Math.round(r * 100)}%; the keeper adds margin at ${Math.round(LOCKE_THRESHOLDS.action * 100)}%, liquidation at 100%`
        }
      >
        <div className={`h-full rounded-full ${fill} transition-[width] duration-700`} style={{ width: `${Math.max(2, r * 100)}%` }} />
        {[LOCKE_THRESHOLDS.watch, LOCKE_THRESHOLDS.action].map((t) => (
          <span key={t} className="absolute top-0 h-full w-0.5 bg-paper" style={{ left: `${t * 100}%` }} />
        ))}
      </div>
      <div className="num mt-1 flex justify-between text-[11px] text-ink-3">
        <span>About 15% when opened</span>
        <span>
          Keeper adds margin at {Math.round(LOCKE_THRESHOLDS.action * 100)}% · Liquidation 100%
        </span>
      </div>
    </div>
  );
}
