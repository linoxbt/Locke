import { notFound } from "next/navigation";
import { PlanHeader } from "@/components/plan/PlanHeader";
import { PlanProvider } from "@/components/plan/PlanProvider";
import { config } from "@/lib/server/config";
import { HttpError } from "@/lib/server/errors";
import { optionalSession } from "@/lib/server/pageAuth";
import { getPlanDetailFor } from "@/lib/server/queries";
import { ViewerBanner } from "@/components/plan/ViewerBanner";

export const dynamic = "force-dynamic";

export default async function PlanLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Signed out or not the owner: the plan is still readable from its link, read-only.
  const s = await optionalSession();
  let detail;
  try {
    detail = await getPlanDetailFor(s?.uid ?? null, id);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  return (
    <PlanProvider initial={detail} priceWs={config.strikePriceWsUrl}>
      <div className="animate-rise">
        {detail.viewer && <ViewerBanner type={detail.plan.type} signedIn={!!s} />}
        <PlanHeader />
        {children}
      </div>
    </PlanProvider>
  );
}
