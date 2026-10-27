import type { Metadata } from "next";
import { ActivityView } from "@/components/plan/ActivityView";
import { planForPage } from "@/lib/server/planRoutes";

export const metadata: Metadata = { title: "Activity — Locke" };

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await planForPage(id, "/activity", ["opening", "active", "closing", "closed", "failed"], { view: true });
  return <ActivityView />;
}
