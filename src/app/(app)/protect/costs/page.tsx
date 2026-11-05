import type { Metadata } from "next";
import { Crumbs } from "@/components/Crumbs";
import { NewVaultForm } from "@/components/base/NewVaultForm";
import { Notice } from "@/components/ui";
import { basePublicClient } from "@/lib/server/baseChain";
import { baseClientSettings, factoryFeeBps, requireBasePage } from "@/lib/server/basePages";
import { readFactoryRoom } from "@/lib/ui/factoryRoom";

export const metadata: Metadata = { title: "Manage your fuel costs — Locke" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const s = await requireBasePage("/protect/costs");
  const { factory, dataSuffix } = baseClientSettings();
  // Before launch (no factory yet) the form still sizes and previews the plan; only creating it waits.
  // Paused or launch caps: the form says so before anything is sent (and checks again when it sends).
  const [feeBps, room] = factory ? await Promise.all([factoryFeeBps(), readFactoryRoom(basePublicClient(), factory).catch(() => null)]) : [null, null];
  return (
    <div className="animate-rise">
      {factory && feeBps == null ? (
        <>
          <Crumbs back={{ href: "/protect", label: "What to protect" }} />
          <Notice tone="danger">Locke couldn&apos;t read its fee from Base just now, so it won&apos;t let you create a plan blind. Reload in a moment.</Notice>
        </>
      ) : (
        <NewVaultForm trail type="costs" address={s.addr} factory={factory} dataSuffix={dataSuffix} feeBps={feeBps} room={room} />
      )}
    </div>
  );
}
