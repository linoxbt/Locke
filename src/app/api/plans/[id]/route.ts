import { NextResponse } from "next/server";
import { idParam, route } from "@/lib/server/http";
import { getPlanDetail } from "@/lib/server/queries";
import { requireSession } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (req: Request, ctx: Ctx) => {
  const s = await requireSession(req);
  const id = idParam((await ctx.params).id, "Plan not found");
  const withPreview = new URL(req.url).searchParams.get("preview") !== "0";
  return NextResponse.json(await getPlanDetail(s.uid, id, { withPreview }));
});
