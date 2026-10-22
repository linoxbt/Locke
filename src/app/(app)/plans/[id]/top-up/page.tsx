import type { Metadata } from "next";
import { TopUpForm } from "@/components/plan/Actions";
import { planForPage } from "@/lib/server/planRoutes";
import { getMarkPrice } from "@/lib/strike/client";

export const metadata: Metadata = { title: "Top up — Locke" };

export default async function TopUpPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await planForPage(id, "/top-up", ["active"]);
  const ada = await getMarkPrice("ADA-USD").catch(() => null);
  return <TopUpForm adaPrice={ada?.mark ?? null} />;
}
