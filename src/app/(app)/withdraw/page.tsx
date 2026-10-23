import type { Metadata } from "next";
import { Display, Eyebrow, Notice } from "@/components/ui";
import { WithdrawForm } from "@/components/WithdrawForm";
import { strikeKeysFor } from "@/lib/server/keys";
import { requirePageSession } from "@/lib/server/pageAuth";
import { reservedUsd } from "@/lib/server/planService";
import { getAccount } from "@/lib/strike/client";
import { usd } from "@/lib/ui/format";

export const metadata: Metadata = { title: "Withdraw — Locke" };
export const dynamic = "force-dynamic";

export default async function WithdrawPage() {
  const s = await requirePageSession("/withdraw");
  let available: number | null = null;
  let reserved = 0;
  try {
    const [acct, r] = await Promise.all([getAccount(await strikeKeysFor(s.uid)), reservedUsd(s.uid)]);
    reserved = r;
    // Credited money a plan is still waiting to use isn't free: the quote route refuses it too.
    available = Math.max(0, (parseFloat(acct.available_balance) || 0) - reserved);
  } catch {
    available = null;
  }
  return (
    <div className="animate-rise grid grid-cols-1 gap-3 lg:grid-cols-12">
      <div className="lg:col-span-5">
        <Eyebrow className="mb-6 text-ink-2">Withdraw</Eyebrow>
        <Display lead="Withdraw." rest="Back to the wallet you signed in with." />
        <p className="mt-6 max-w-[40ch] text-[14px] leading-relaxed text-ink-2">
          Free balance is what&apos;s on Strike outside your plans&apos; margin, for example after you close a plan. Funds can only go to your
          connected wallet, and your wallet signs every withdrawal.
        </p>
        <div className="mt-6">
          <div className="text-[13px] text-ink-2">Free balance on Strike</div>
          <div className="num mt-1 text-[26px] leading-none">{available == null ? "—" : usd(available)}</div>
          {available != null && reserved > 0 && (
            <p className="mt-2 text-[13px] text-ink-3">{usd(reserved)} more is set aside for your plans&apos; funding and top-ups.</p>
          )}
        </div>
      </div>
      <div className="space-y-3 lg:col-span-7">
        {available == null && <Notice>Strike is unreachable right now, so the balance can&apos;t be shown. You can still try.</Notice>}
        <WithdrawForm available={available} />
      </div>
    </div>
  );
}
