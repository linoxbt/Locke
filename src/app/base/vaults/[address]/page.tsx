import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VaultView } from "@/components/base/VaultView";
import { baseClientSettings, factoryKeeper, requireBasePage } from "@/lib/server/basePages";
import { vaultDetail } from "@/lib/server/baseVaults";
import { HttpError } from "@/lib/server/errors";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Vault · Locke on Base" };

export default async function VaultPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const s = await requireBasePage(`/base/vaults/${address}`);
  let detail;
  try {
    detail = await vaultDetail(s.uid, address);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const { dataSuffix } = baseClientSettings();
  return <VaultView initial={detail} dataSuffix={dataSuffix} factoryKeeper={await factoryKeeper()} />;
}
