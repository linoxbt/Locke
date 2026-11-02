import type { Metadata } from "next";
import { BaseAccountBar } from "@/components/base/BaseAccountBar";
import { Arrow, Card, Display, Eyebrow, LinkButton, Stat } from "@/components/ui";
import { requireBasePage } from "@/lib/server/basePages";
import { listVaults } from "@/lib/server/baseVaults";
import { shortAddr } from "@/lib/ui/format";

export const metadata: Metadata = { title: "Account — Locke" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const s = await requireBasePage("/account");
  const plans = await listVaults(s.uid);
  const open = plans.filter((p) => p.status !== "closed").length;
  return (
    <div className="animate-rise space-y-3">
      <div className="pb-6">
        <Eyebrow className="mb-6 text-ink-2">Account</Eyebrow>
        <Display lead="Your account." rest="The wallet you signed in with, on Base." />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <h2 className="display text-[17px]">Wallet</h2>
          <div className="mt-6 grid grid-cols-2 gap-6">
            <Stat label="Address" value={<span title={s.addr}>{shortAddr(s.addr)}</span>} />
            <Stat label="Network" value="Base" />
          </div>
          <div className="mt-6 border-t border-line pt-6">
            <BaseAccountBar address={s.addr} />
          </div>
        </Card>
        <Card tone="ink" className="flex flex-col lg:col-span-5">
          <h2 className="display text-[17px]">Plans</h2>
          <div className="mt-6 grid grid-cols-2 gap-6">
            <Stat subtle="text-paper/55" label="Open" value={String(open)} />
            <Stat subtle="text-paper/55" label="All time" value={String(plans.length)} />
          </div>
          <LinkButton href="/portfolio" variant="paper" className="mt-auto self-start">
            Portfolio <Arrow />
          </LinkButton>
        </Card>
      </div>
    </div>
  );
}
