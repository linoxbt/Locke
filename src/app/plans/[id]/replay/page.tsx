import type { Metadata } from "next";
import { ReplayPanel } from "@/components/ReplayPanel";
import { Card } from "@/components/ui";
import type { CostsInputs } from "@/lib/domain/types";
import { planForPage } from "@/lib/server/planRoutes";

export const metadata: Metadata = { title: "Replay — Locke" };

export default async function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = await planForPage(id, "/replay", ["draft", "funding", "opening", "active", "closing", "closed", "failed"]);
  const c = plan.inputs as CostsInputs;
  return (
    <Card tone="ink" className="sm:p-10">
      <ReplayPanel planId={plan.id} type={plan.type} currency={plan.type === "costs" ? c.currency : "USD"} litres={plan.type === "costs" ? c.litresPerMonth : 1} />
    </Card>
  );
}
