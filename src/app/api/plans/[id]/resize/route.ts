import { NextResponse } from "next/server";
import { idParam, readJson, route } from "@/lib/server/http";
import { resizePlan } from "@/lib/server/planService";
import { LIMITS, rateLimit } from "@/lib/server/rateLimit";
import { requireSession } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, ctx: Ctx) => {
  const s = await requireSession(req);
  const id = idParam((await ctx.params).id, "Plan not found");
  rateLimit(`${s.uid}:resize`, LIMITS.strikeWrite);
  const plan = await resizePlan(s.uid, id, await readJson(req));
  return NextResponse.json({ status: plan.status, size: plan.size });
});
