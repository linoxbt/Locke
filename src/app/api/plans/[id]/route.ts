import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { route } from "@/lib/server/http";
import { strikeKeysFor } from "@/lib/server/keys";
import { loadPlan, planView, previewFor } from "@/lib/server/planService";
import { requireSession } from "@/lib/server/session";
import { getPosition } from "@/lib/strike/client";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (req: Request, ctx: Ctx) => {
  const s = await requireSession(req);
  const { id } = await ctx.params;
  const plan = await loadPlan(s.uid, id);
  const live = plan.status === "active" || plan.status === "closing";
  let pos = null;
  let liveError: string | null = null;
  if (live) {
    try {
      pos = await getPosition(await strikeKeysFor(s.uid), plan.symbol);
    } catch (e) {
      liveError = e instanceof Error ? e.message : "Strike is unreachable";
    }
  }
  const sql = db();
  const [view, events, snapshots, deposits] = await Promise.all([
    planView(plan, pos),
    sql`select id, level, message, created_at from plan_events where plan_id = ${plan.id} order by id desc limit 40`,
    sql`select mark, ratio, headline, created_at from snapshots where plan_id = ${plan.id}
        and created_at > now() - interval '7 days' order by created_at asc limit 2000`,
    sql`select id, purpose, status, lovelace, usd_value, tx_hash, created_at from deposits
        where plan_id = ${plan.id} order by created_at desc limit 20`,
  ]);
  const preview = plan.status === "draft" || plan.status === "funding" ? await previewFor(plan) : null;
  return NextResponse.json({ plan: view, preview, events, snapshots, deposits, liveError });
});
