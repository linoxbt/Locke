import type { Metadata } from "next";
import { ResizeForm } from "@/components/plan/Actions";
import { planForPage } from "@/lib/server/planRoutes";

export const metadata: Metadata = { title: "Resize — Locke" };

export default async function ResizePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await planForPage(id, "/resize", ["active"]);
  return <ResizeForm />;
}
