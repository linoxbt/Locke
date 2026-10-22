import type { Metadata } from "next";
import { PortfolioView } from "@/components/PortfolioView";
import { requirePageSession } from "@/lib/server/pageAuth";
import { listPlanViews } from "@/lib/server/queries";

export const metadata: Metadata = { title: "Portfolio — Locke" };
export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const s = await requirePageSession("/portfolio");
  const initial = await listPlanViews(s.uid);
  return (
    <div className="animate-rise">
      <PortfolioView initial={initial} />
    </div>
  );
}
