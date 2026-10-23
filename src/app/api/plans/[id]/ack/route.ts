import { NextResponse } from "next/server";
import { idParam, route } from "@/lib/server/http";
import { acknowledgeRisks } from "@/lib/server/planService";
import { LIMITS, rateLimit } from "@/lib/server/rateLimit";
import { requireSession } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Record that the user accepted this plan's risk disclosures (required before funding or opening). */
export const POST = route(async (req: Request, ctx: Ctx) => {
  const s = await requireSession(req);
  const id = idParam((await ctx.params).id, "Plan not found");
  rateLimit(`${s.uid}:ack`, LIMITS.ack);
  const plan = await acknowledgeRisks(s.uid, id);
  return NextResponse.json({ riskAcknowledged: !!plan.risk_ack_at });
});
