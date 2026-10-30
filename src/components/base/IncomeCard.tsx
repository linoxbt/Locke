"use client";

import { useEffect, useState } from "react";
import { encodeFunctionData, type Hex } from "viem";
import { USDC, usdcUnits } from "@/lib/base/contracts";
import { onChain, SHARE_RANGE, SPEND_PERMISSION_MANAGER, spendPermissionManagerAbi, WEEKLY_CAP_RANGE } from "@/lib/base/income";
import { providerFor, rememberedKind, sendBaseCalls, walletErrorMessage, walletFor } from "@/lib/base/wallet";
import type { IncomeView } from "@/lib/server/baseIncome";
import { usd } from "@/lib/ui/format";
import { Ago } from "../Time";
import { Field, Slider } from "../form";
import { Button, Card, ErrorNote, inputCls, Notice, Stat } from "../ui";

/**
 * "Protect as you get paid": the owner's Base Account signs one spend permission (this vault as
 * spender, a weekly cap), and Locke's keeper moves the chosen share of incoming USDC into the vault.
 * Turning it off stops the keeper at once and asks the wallet to revoke the permission.
 */
export function IncomeCard({
  vault,
  owner,
  income,
  closed,
  dataSuffix,
  onChange,
}: {
  vault: string;
  owner: string;
  income: IncomeView | null;
  closed: boolean;
  dataSuffix?: Hex;
  onChange: () => Promise<void>;
}) {
  const [share, setShare] = useState(10);
  const [cap, setCap] = useState("500");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [baseAccount, setBaseAccount] = useState(true);
  useEffect(() => setBaseAccount(rememberedKind() === "base"), []);

  const on = income?.status === "on";
  const capUsd = Number(cap);
  const capOk = Number.isFinite(capUsd) && capUsd >= WEEKLY_CAP_RANGE.min && capUsd <= WEEKLY_CAP_RANGE.max;

  async function turnOn() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      // The browser build of the SDK: its default entry bundles Coinbase's server SDK.
      const { requestSpendPermission } = await import("@base-org/account/spend-permission/browser");
      const provider = await providerFor("base");
      const signed = await requestSpendPermission({
        account: owner,
        spender: vault,
        token: USDC,
        chainId: 8453,
        allowance: usdcUnits(capUsd),
        periodInDays: 7,
        provider: provider as never,
      });
      const r = await fetch(`/api/base/vaults/${vault}/income`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permission: signed.permission, signature: signed.signature, sharePct: share }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? "Couldn't turn it on");
      await onChange();
      setNote(`On. ${share}% of the USDC your account receives moves into this vault, up to ${usd(capUsd, 0)} a week.`);
    } catch (e) {
      setError(walletErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!income) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      // Stop Locke first, so nothing more moves whatever the wallet does next.
      const r = await fetch(`/api/base/vaults/${vault}/income`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? "Couldn't turn it off");
      await onChange();
      setNote("Off: Locke has stopped. Confirm in your wallet to revoke the permission too.");
      try {
        const wallet = await walletFor(owner, dataSuffix);
        await sendBaseCalls(wallet, [
          { to: SPEND_PERMISSION_MANAGER, data: encodeFunctionData({ abi: spendPermissionManagerAbi, functionName: "revoke", args: [onChain(income.permission)] }) },
        ]);
        setNote("Off, and the permission is revoked in your wallet.");
      } catch {
        setNote("Off: Locke has stopped. Your wallet didn't revoke the permission itself; you can revoke it any time in your Base Account settings.");
      }
    } catch (e) {
      setError(walletErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="eyebrow">Protect as you get paid</div>
        {on && <span className="rounded-full bg-ok/15 px-3 py-1 text-[12px] font-medium text-ok">On</span>}
      </div>

      {on && income ? (
        <>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Stat label="Share of income" value={`${income.sharePct}%`} />
            <Stat label="Weekly cap" value={usd(income.weeklyCapUsd, 0)} />
            <Stat label="Moved so far" value={usd(income.collectedUsd)} sub={income.lastCollectedAt ? <>Last <Ago iso={income.lastCollectedAt} /></> : "Nothing yet"} />
            <Stat label="Waiting" value={usd(income.pendingUsd)} sub="Moves once it reaches $5, within the cap" />
          </div>
          <Button variant="ghost" onClick={turnOff} busy={busy} disabled={busy}>
            Turn off
          </Button>
        </>
      ) : (
        <>
          <p className="text-[14px] leading-relaxed text-ink-2">
            Set aside part of what your business earns. When USDC arrives in your Base Account, Locke moves your share into this vault,
            never more than your weekly cap. You sign once; you can turn it off or revoke it in your wallet at any time.
          </p>
          <Field label={`Share of incoming USDC: ${share}%`} group>
            <Slider label="Share of incoming USDC" value={share} min={SHARE_RANGE.min} max={SHARE_RANGE.max} step={5} onChange={setShare} />
          </Field>
          <Field label="Weekly cap (USDC)" hint="Base Account enforces this: the vault can never take more in a week.">
            <input className={inputCls} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />
          </Field>
          {!baseAccount && <Notice tone="info">This needs a Base Account. Sign out and sign in with Base Account to turn it on.</Notice>}
          <Button onClick={turnOn} busy={busy} disabled={busy || !capOk || closed || !baseAccount}>
            Turn on and sign in your Base Account
          </Button>
        </>
      )}
      {note && <Notice tone="info">{note}</Notice>}
      <ErrorNote error={error} />
    </Card>
  );
}
