import { NextResponse } from "next/server";
import { readJson, route } from "@/lib/server/http";
import { confirmDeposit } from "@/lib/server/planService";
import { requireSession } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, ctx: Ctx) => {
  const s = await requireSession(req);
  const { id } = await ctx.params;
  const body = await readJson(req);
  return NextResponse.json(await confirmDeposit(s.uid, id, String(body.txHash ?? "")));
});
