import { NextResponse } from "next/server";
import { replay } from "@/lib/domain/plans";
import { idParam, route } from "@/lib/server/http";
import { loadPlan } from "@/lib/server/planService";
import { LIMITS, rateLimit } from "@/lib/server/rateLimit";
import { requireSession } from "@/lib/server/session";
import { getDailyCloses, getMarkPrice } from "@/lib/strike/client";

type Ctx = { params: Promise<{ id: string }> };

/** Simulation: the plan against real Strike mark history. Funding uses today's rate as a constant. */
export const GET = route(async (req: Request, ctx: Ctx) => {
  const s = await requireSession(req);
  const id = idParam((await ctx.params).id, "Plan not found");
  rateLimit(`${s.uid}:replay`, LIMITS.read);
  const plan = await loadPlan(s.uid, id);
  const days = [30, 90, 180].includes(Number(new URL(req.url).searchParams.get("days")))
    ? Number(new URL(req.url).searchParams.get("days"))
    : 90;
  const [closes, mark] = await Promise.all([getDailyCloses(plan.symbol, days), getMarkPrice(plan.symbol)]);
  const points = replay(plan.type, plan.inputs, plan.size, closes, mark.fundingRate);
  const availableDays = closes.length;
  return NextResponse.json({
    days,
    availableDays,
    shortened: availableDays < days,
    hourlyFundingRate: mark.fundingRate,
    points,
  });
});
