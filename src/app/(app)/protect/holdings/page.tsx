import type { Metadata } from "next";
import { Crumbs } from "@/components/Crumbs";
import { NewVaultForm } from "@/components/base/NewVaultForm";
import { Notice } from "@/components/ui";
import { baseClientSettings, factoryFeeBps, requireBasePage } from "@/lib/server/basePages";

export const metadata: Metadata = { title: "Protect what you hold — Locke" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const s = await requireBasePage("/protect/holdings");
  const { factory, dataSuffix } = baseClientSettings();
  // Before launch (no factory yet) the form still sizes and previews the plan; only creating it waits.
  const feeBps = factory ? await factoryFeeBps() : null;
  return (
    <div className="animate-rise">
      {factory && feeBps == null ? (
        <>
          <Crumbs back={{ href: "/protect", label: "What to protect" }} />
          <Notice tone="danger">Locke couldn&apos;t read its fee from Base just now, so it won&apos;t let you create a plan blind. Reload in a moment.</Notice>
        </>
      ) : (
        <NewVaultForm trail type="holdings" address={s.addr} factory={factory} dataSuffix={dataSuffix} feeBps={feeBps} />
      )}
    </div>
  );
}
