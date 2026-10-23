import { NextResponse } from "next/server";
import { idParam, route } from "@/lib/server/http";
import { syncPlan } from "@/lib/server/planService";
import { LIMITS, rateLimit } from "@/lib/server/rateLimit";
import { requireSession } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, ctx: Ctx) => {
  const s = await requireSession(req);
  const id = idParam((await ctx.params).id, "Plan not found");
  rateLimit(`${s.uid}:sync`, LIMITS.sync);
  const plan = await syncPlan(s.uid, id);
  return NextResponse.json({ status: plan.status, statusNote: plan.status_note });
});
