import type { Metadata } from "next";
import Link from "next/link";
import { BaseAccountBar } from "@/components/base/BaseAccountBar";
import { BaseMark, SignInWithBase } from "@/components/base/SignInWithBase";
import { Arrow, Card, Display, Eyebrow, LinkButton, Notice, StateChip } from "@/components/ui";
import { baseMarket } from "@/lib/base/contracts";
import { safeNext } from "@/lib/server/pageAuth";
import { baseClientSettings, optionalBaseSession } from "@/lib/server/basePages";
import { listVaults } from "@/lib/server/baseVaults";
import { usd } from "@/lib/ui/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Locke on Base",
  description: "Protection vaults on Base: hedge a crypto treasury or a fuel budget, held in a vault you own.",
};

export default async function BaseHome({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const s = await optionalBaseSession();
  const { factory } = baseClientSettings();
  const next = safeNext((await searchParams).next, "/base");

  if (!s) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card tone="ink" className="flex flex-col justify-between gap-10 p-6 sm:p-8">
          <div>
            <Eyebrow className="flex items-center gap-2 text-lime">
              <BaseMark size={12} /> Locke on Base
            </Eyebrow>
            <Display
              size="xl"
              className="mt-4"
              lead="Protect your treasury and fuel budget"
              rest="from a vault you own on Base."
              restClass="text-paper/55"
            />
          </div>
          <ul className="grid gap-3 text-[14px] leading-relaxed text-paper/80 sm:grid-cols-3">
            <li>Your USDC sits in your own vault contract. Only you can withdraw it.</li>
            <li>Locke&apos;s keeper hedges on Avantis within limits written into the vault.</li>
            <li>Close or withdraw from your wallet at any time, even if Locke is offline.</li>
          </ul>
        </Card>
        <Card className="flex flex-col gap-5 p-6 sm:p-8">
          <Display size="md" lead="Sign in" rest="with your Base account." />
          {!factory && <Notice tone="info">Locke on Base isn&apos;t live yet. You can sign in; creating vaults opens at launch.</Notice>}
          <SignInWithBase next={next} />
        </Card>
      </div>
    );
  }

  const vaults = await listVaults(s.uid);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Display lead="Your vaults" rest="on Base." />
        <div className="flex flex-wrap items-center gap-3">
          <BaseAccountBar address={s.addr} />
          {factory && (
            <LinkButton href="/base/new">
              New vault <Arrow />
            </LinkButton>
          )}
        </div>
      </div>
      {!factory && <Notice tone="info">Locke on Base isn&apos;t live yet. Vaults open at launch.</Notice>}
      {vaults.length === 0 ? (
        <Card className="p-6 text-[14px] text-ink-2">No vaults yet. {factory && <Link href="/base/new" className="text-cobalt underline">Create your first one.</Link>}</Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {vaults.map((v) => (
            <Link key={v.address} href={`/base/vaults/${v.address}`} className="block rounded-[var(--radius-card)] bg-paper p-5 transition hover:ring-1 hover:ring-ink">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[16px] font-medium">{v.name}</div>
                  <div className="num mt-1 text-[13px] text-ink-3">{baseMarket(Number(v.pair_index))?.symbol}</div>
                </div>
                <StateChip status={v.status} />
              </div>
              <div className="num mt-4 text-[13px] text-ink-2">
                Hedge {usd(v.sizing?.notionalUsd)} · deposited {usd(v.sizing?.depositUsd)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
