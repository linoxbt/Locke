import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readJson, route } from "@/lib/server/http";
import { strikeKeysFor } from "@/lib/server/keys";
import { createDraft, planView, type PlanRow } from "@/lib/server/planService";
import { requireSession } from "@/lib/server/session";
import { getPositions, type StrikePosition } from "@/lib/strike/client";
import type { PlanType } from "@/lib/domain/types";

/** Portfolio: every non-draft plan with live numbers from one positions call. */
export const GET = route(async (req: Request) => {
  const s = await requireSession(req);
  const rows = (await db()`
    select * from plans where user_id = ${s.uid} and status <> 'draft'
    order by (status = 'closed'), created_at desc limit 50`) as unknown as PlanRow[];
  let positions: StrikePosition[] = [];
  if (rows.some((r) => r.status === "active" || r.status === "closing")) {
    positions = await getPositions(await strikeKeysFor(s.uid));
  }
  const plans = await Promise.all(rows.map((r) => planView(r, positions.find((p) => p.symbol === r.symbol))));
  return NextResponse.json({ plans });
});

/** Create a draft and return its preview. Sizing happens here, from live Strike data. */
export const POST = route(async (req: Request) => {
  const s = await requireSession(req);
  const body = await readJson(req);
  const type = String(body.type) as PlanType;
  const inputs = (body.inputs && typeof body.inputs === "object" ? body.inputs : {}) as Record<string, unknown>;
  const { plan, preview } = await createDraft(s.uid, type, inputs);
  return NextResponse.json({ planId: plan.id, name: plan.name, preview });
});
