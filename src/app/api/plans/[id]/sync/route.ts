import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { syncPlan } from "@/lib/server/planService";
import { requireSession } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, ctx: Ctx) => {
  const s = await requireSession(req);
  const { id } = await ctx.params;
  const plan = await syncPlan(s.uid, id);
  return NextResponse.json({ status: plan.status, statusNote: plan.status_note });
});
