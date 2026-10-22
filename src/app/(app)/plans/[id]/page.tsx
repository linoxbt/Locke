import type { Metadata } from "next";
import { PlanOverview } from "@/components/plan/PlanOverview";
import { planForPage } from "@/lib/server/planRoutes";

export const metadata: Metadata = { title: "Plan — Locke" };

export default async function PlanOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await planForPage(id, "", ["active", "closing", "closed", "failed"]);
  return <PlanOverview />;
}
