import type { Metadata } from "next";
import { CREATE_STEPS, Crumbs } from "@/components/Crumbs";
import { FundStep } from "@/components/plan/FundStep";
import { planForPage } from "@/lib/server/planRoutes";
import { getMarkPrice } from "@/lib/strike/client";

export const metadata: Metadata = { title: "Fund — Locke" };

export default async function FundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await planForPage(id, "/fund", ["draft", "funding", "opening"]);
  const ada = await getMarkPrice("ADA-USD").catch(() => null);
  return (
    <>
      <Crumbs steps={CREATE_STEPS} current={3} />
      <FundStep adaPrice={ada?.mark ?? null} />
    </>
  );
}
