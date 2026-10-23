import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { acknowledgeRisks } from "@/lib/server/planService";
import { requireSession } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Record that the user accepted this plan's risk disclosures (required before funding or opening). */
export const POST = route(async (req: Request, ctx: Ctx) => {
  const s = await requireSession(req);
  const { id } = await ctx.params;
  const plan = await acknowledgeRisks(s.uid, id);
  return NextResponse.json({ riskAcknowledged: !!plan.risk_ack_at });
});
