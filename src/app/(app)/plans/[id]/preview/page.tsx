import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CREATE_STEPS, Crumbs } from "@/components/Crumbs";
import { PreviewStep } from "@/components/plan/PreviewStep";
import { hasDepositInFlight, planForPage } from "@/lib/server/planRoutes";
import { getMarkPrice } from "@/lib/strike/client";

export const metadata: Metadata = { title: "Preview — Locke" };

export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = await planForPage(id, "/preview", ["draft", "funding"]);
  if (await hasDepositInFlight(plan.id)) redirect(`/plans/${plan.id}/fund`);
  const ada = await getMarkPrice("ADA-USD").catch(() => null);
  return (
    <>
      <Crumbs steps={CREATE_STEPS} current={2} />
      <PreviewStep adaPrice={ada?.mark ?? null} />
    </>
  );
}
