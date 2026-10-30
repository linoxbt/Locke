import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BaseAccountBar } from "@/components/base/BaseAccountBar";
import { NewVaultForm } from "@/components/base/NewVaultForm";
import { Display, Notice } from "@/components/ui";
import { baseClientSettings, factoryFeeBps, requireBasePage } from "@/lib/server/basePages";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New vault · Locke on Base" };

export default async function NewVault() {
  const s = await requireBasePage("/base/new");
  const { factory, dataSuffix } = baseClientSettings();
  if (!factory) redirect("/base");
  // The fee is shown before anything is signed, so a vault is never created without knowing it.
  const feeBps = await factoryFeeBps();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Display lead="New vault" rest="sized for what you protect." />
        <BaseAccountBar address={s.addr} />
      </div>
      {feeBps == null ? (
        <Notice tone="danger">Locke couldn&apos;t read its fee from Base just now, so it won&apos;t let you create a vault blind. Reload in a moment.</Notice>
      ) : (
        <NewVaultForm address={s.addr} factory={factory} dataSuffix={dataSuffix} feeBps={feeBps} />
      )}
    </div>
  );
}
