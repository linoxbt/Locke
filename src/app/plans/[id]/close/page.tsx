import type { Metadata } from "next";
import { CloseForm } from "@/components/plan/Actions";
import { planForPage } from "@/lib/server/planRoutes";

export const metadata: Metadata = { title: "Close — Locke" };

export default async function ClosePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await planForPage(id, "/close", ["active"]);
  return <CloseForm />;
}
