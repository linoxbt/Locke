import { NextResponse } from "next/server";
import { readJson, route } from "@/lib/server/http";
import { createDraft } from "@/lib/server/planService";
import { listPlanViews } from "@/lib/server/queries";
import { LIMITS, rateLimit } from "@/lib/server/rateLimit";
import { requireSession } from "@/lib/server/session";
import type { PlanType } from "@/lib/domain/types";

/** Portfolio: every non-draft plan with live numbers from one positions call. */
export const GET = route(async (req: Request) => {
  const s = await requireSession(req);
  return NextResponse.json(await listPlanViews(s.uid));
});

/** Create a draft and return its preview. Sizing happens here, from live Strike data. */
export const POST = route(async (req: Request) => {
  const s = await requireSession(req);
  rateLimit(`${s.uid}:plans`, LIMITS.strikeWrite);
  const body = await readJson(req);
  const type = String(body.type) as PlanType;
  const inputs = (body.inputs && typeof body.inputs === "object" ? body.inputs : {}) as Record<string, unknown>;
  const { plan, preview } = await createDraft(s.uid, type, inputs);
  return NextResponse.json({ planId: plan.id, name: plan.name, preview });
});
