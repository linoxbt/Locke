import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { getPlanDetail } from "@/lib/server/queries";
import { requireSession } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (req: Request, ctx: Ctx) => {
  const s = await requireSession(req);
  const { id } = await ctx.params;
  return NextResponse.json(await getPlanDetail(s.uid, id));
});
