import { NextResponse } from "next/server";
import { readJson, route } from "@/lib/server/http";
import { resizePlan } from "@/lib/server/planService";
import { requireSession } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, ctx: Ctx) => {
  const s = await requireSession(req);
  const { id } = await ctx.params;
  const plan = await resizePlan(s.uid, id, await readJson(req));
  return NextResponse.json({ status: plan.status, size: plan.size });
});
