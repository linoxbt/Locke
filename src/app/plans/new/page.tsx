import type { Metadata } from "next";
import { BaseAccountBar } from "@/components/base/BaseAccountBar";
import { NewVaultForm } from "@/components/base/NewVaultForm";
import { Display, Notice } from "@/components/ui";
import { baseClientSettings, factoryFeeBps, requireBasePage } from "@/lib/server/basePages";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New plan · Locke" };

export default async function NewPlan() {
  const s = await requireBasePage("/plans/new");
  const { factory, dataSuffix } = baseClientSettings();
  // Before launch (no factory yet) the form still sizes and previews a plan; only creating it waits.
  // After launch the fee is read from Base and shown before anything is signed.
  const feeBps = factory ? await factoryFeeBps() : null;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Display lead="New plan" rest="sized for what you protect." />
        <BaseAccountBar address={s.addr} />
      </div>
      {!factory && (
        <Notice tone="info">Locke isn&apos;t live yet. You can size and preview a plan now; creating it opens at launch.</Notice>
      )}
      {factory && feeBps == null ? (
        <Notice tone="danger">Locke couldn&apos;t read its fee from Base just now, so it won&apos;t let you create a plan blind. Reload in a moment.</Notice>
      ) : (
        <NewVaultForm address={s.addr} factory={factory} dataSuffix={dataSuffix} feeBps={feeBps} />
      )}
    </div>
  );
}
