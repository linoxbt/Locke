import { NextResponse } from "next/server";
import { idParam, readJson, route } from "@/lib/server/http";
import { confirmDeposit } from "@/lib/server/planService";
import { LIMITS, rateLimit } from "@/lib/server/rateLimit";
import { requireSession } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, ctx: Ctx) => {
  const s = await requireSession(req);
  const id = idParam((await ctx.params).id, "Deposit not found");
  rateLimit(`${s.uid}:deposit-confirm`, LIMITS.strikeWrite);
  const body = await readJson(req);
  return NextResponse.json(await confirmDeposit(s.uid, id, String(body.txHash ?? "")));
});
