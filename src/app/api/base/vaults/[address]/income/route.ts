import { NextResponse } from "next/server";
import { disableIncome, enableIncome } from "@/lib/server/baseIncome";
import { requireBaseSession } from "@/lib/server/baseSession";
import { readJson, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";

type Ctx = { params: Promise<{ address: string }> };

/** Turn on "Protect as you get paid" with the owner's signed spend permission. */
export const POST = route(async (req: Request, ctx: Ctx) => {
  const s = await requireBaseSession(req);
  rateLimit(`${s.uid}:base-income`, 20);
  const { address } = await ctx.params;
  return NextResponse.json(await enableIncome(s.uid, address, await readJson(req)));
});

/** Turn it off. */
export const DELETE = route(async (req: Request, ctx: Ctx) => {
  const s = await requireBaseSession(req);
  const { address } = await ctx.params;
  await disableIncome(s.uid, address);
  return NextResponse.json({ ok: true });
});
