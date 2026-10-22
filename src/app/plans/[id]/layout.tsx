import { notFound } from "next/navigation";
import { PlanHeader } from "@/components/plan/PlanHeader";
import { PlanProvider } from "@/components/plan/PlanProvider";
import { HttpError } from "@/lib/server/errors";
import { requirePageSession } from "@/lib/server/pageAuth";
import { getPlanDetail } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

export default async function PlanLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requirePageSession(`/plans/${id}`);
  let detail;
  try {
    detail = await getPlanDetail(s.uid, id);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  return (
    <PlanProvider initial={detail}>
      <div className="animate-rise">
        <PlanHeader />
        {children}
      </div>
    </PlanProvider>
  );
}
