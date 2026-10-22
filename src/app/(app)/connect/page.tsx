import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ConnectPanel } from "@/components/ConnectPanel";
import { Card, Display, Eyebrow } from "@/components/ui";
import { optionalSession, safeNext } from "@/lib/server/pageAuth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Connect — Locke" };

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await optionalSession()) redirect(next);

  return (
    <div className="animate-rise grid grid-cols-1 gap-3 pt-6 lg:grid-cols-12 lg:pt-12">
      <div className="lg:col-span-6">
        <Eyebrow className="mb-6 text-ink-2">Connect</Eyebrow>
        <Display lead="Connect a Cardano wallet." rest="One signature, no funds move." className="max-w-[14ch]" />
        <ul className="mt-10 max-w-[46ch] space-y-4 text-[16px] leading-relaxed text-ink-2">
          <li>Your signature links this wallet to Strike through Locke and signs you in. It can&apos;t move funds.</li>
          <li>Locke creates a Strike API key for routine calls. It can place orders, but withdrawals always need your wallet and only go back to it.</li>
          <li>Every deposit asks your wallet again.</li>
        </ul>
      </div>
      <Card className="flex flex-col lg:col-span-6 lg:min-h-[420px]">
        <h2 className="display text-[28px]">Choose your wallet</h2>
        <p className="mt-2 text-[15px] text-ink-2">Cardano mainnet. Eternl, Lace, Vespr and other CIP-30 wallets work.</p>
        <div className="mt-auto pt-10">
          <ConnectPanel next={next} />
        </div>
      </Card>
    </div>
  );
}
