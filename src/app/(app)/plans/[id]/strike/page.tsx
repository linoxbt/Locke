import type { Metadata } from "next";
import { StrikeDetails } from "@/components/plan/StrikeDetails";
import { planForPage } from "@/lib/server/planRoutes";

export const metadata: Metadata = { title: "Strike details — Locke" };

export default async function StrikePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await planForPage(id, "/strike", ["opening", "active", "closing", "closed", "failed"]);
  return <StrikeDetails />;
}
