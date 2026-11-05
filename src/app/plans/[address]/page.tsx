import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VaultView } from "@/components/base/VaultView";
import { baseClientSettings, factoryKeeper, requireBasePage } from "@/lib/server/basePages";
import { basePublicClient } from "@/lib/server/baseChain";
import { vaultDetail } from "@/lib/server/baseVaults";
import { HttpError } from "@/lib/server/errors";
import { readFactoryRoom } from "@/lib/ui/factoryRoom";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Plan · Locke" };

export default async function PlanPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const s = await requireBasePage(`/plans/${address}`);
  let detail;
  try {
    detail = await vaultDetail(s.uid, address);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const { dataSuffix, factory } = baseClientSettings();
  // The launch caps, so a deposit they'd refuse says so instead of failing on Base. Unread, the vault still enforces them.
  const [keeper, room] = await Promise.all([factoryKeeper(), factory ? readFactoryRoom(basePublicClient(), factory).catch(() => null) : null]);
  return <VaultView initial={detail} viewer={s.addr} dataSuffix={dataSuffix} factoryKeeper={keeper} factory={factory} room={room} />;
}
