import type { Metadata } from "next";
import { SignOutButton } from "@/components/AccountActions";
import { DelegationPanel } from "@/components/plan/DelegationPanel";
import { Arrow, Card, Display, Eyebrow, LinkButton, Stat } from "@/components/ui";
import { strikeKeysFor } from "@/lib/server/keys";
import { requirePageSession } from "@/lib/server/pageAuth";
import { getAccountInfo } from "@/lib/server/queries";
import { getAccount } from "@/lib/strike/client";
import { shortAddr, usd } from "@/lib/ui/format";
import { config } from "@/lib/server/config";

export const metadata: Metadata = { title: "Account — Locke" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const s = await requirePageSession("/account");
  const info = await getAccountInfo(s.uid);
  let balance: { wallet: number; available: number } | null = null;
  try {
    const a = await getAccount(await strikeKeysFor(s.uid));
    balance = { wallet: parseFloat(a.wallet_balance) || 0, available: parseFloat(a.available_balance) || 0 };
  } catch {
    balance = null;
  }
  let feeBps: number | null = null;
  try {
    feeBps = config.builderFeeBps;
  } catch {
    feeBps = null;
  }

  return (
    <div className="animate-rise space-y-3">
      <div className="pb-6">
        <Eyebrow className="mb-6 text-ink-2">Account</Eyebrow>
        <Display lead="Your account." rest="Wallet, Strike, and where your ADA is staked." />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <h2 className="display text-[24px]">Wallet</h2>
          <div className="mt-6 space-y-5">
            <Stat label="Address" value={<span title={info?.address}>{info ? shortAddr(info.address) : "—"}</span>} />
            <Stat label="Stake address" value={info?.stakeAddress ? shortAddr(info.stakeAddress) : "Not shared by the wallet"} />
            <Stat label="Member since" value={info ? new Date(info.createdAt).toLocaleDateString("en-GB", { dateStyle: "medium" }) : "—"} />
          </div>
          <div className="mt-8 border-t border-line pt-6">
            <SignOutButton />
          </div>
        </Card>
        <div className="lg:col-span-5">
          <DelegationPanel q={0} hideCovered />
        </div>
        <Card tone="ink" className="lg:col-span-7">
          <h2 className="display text-[24px]">Strike</h2>
          <div className="mt-6 grid grid-cols-2 gap-6">
            <Stat subtle="text-paper/55" label="Balance" value={balance ? usd(balance.wallet) : "—"} />
            <Stat subtle="text-paper/55" label="Free to withdraw" value={balance ? usd(balance.available) : "—"} />
            <Stat subtle="text-paper/55" label="Account" value={info?.accountId ? shortAddr(info.accountId) : "—"} />
            <Stat subtle="text-paper/55" label="Locke builder fee" value={feeBps == null ? "—" : `${feeBps} bps`} sub="per order" />
          </div>
          <LinkButton href="/withdraw" variant="paper" className="mt-8">
            Withdraw <Arrow />
          </LinkButton>
        </Card>
        <Card tone="mist" className="lg:col-span-5">
          <h2 className="display text-[24px]">Security</h2>
          <ul className="mt-5 space-y-3 text-[14px] leading-relaxed text-ink-2">
            <li>Locke holds one Strike API key for you, encrypted. It can place orders but can&apos;t withdraw.</li>
            <li>Withdrawals and deposits always need your wallet&apos;s signature.</li>
            <li>Signing in again replaces the API key and revokes the old one.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
