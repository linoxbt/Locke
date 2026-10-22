import { NextResponse } from "next/server";
import { isBech32Address } from "@/lib/cardano/bech32";
import { HttpError } from "@/lib/server/errors";
import { readJson, route } from "@/lib/server/http";
import { prepareDeposit } from "@/lib/server/planService";
import { requireSession } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Quote and build the Cardano deposit for opening or topping up a plan. The wallet signs it in the browser. */
export const POST = route(async (req: Request, ctx: Ctx) => {
  const s = await requireSession(req);
  const { id } = await ctx.params;
  const body = await readJson(req);
  const purpose = body.purpose === "topup" ? "topup" : "open";
  const address = String(body.address ?? s.addr);
  if (!isBech32Address(address)) throw new HttpError(400, "Invalid address");
  const utxos = Array.isArray(body.utxos) ? (body.utxos as string[]).slice(0, 300) : [];
  const result = await prepareDeposit(s.uid, id, purpose, {
    address,
    utxos,
    amountUsd: body.amountUsd === undefined ? undefined : Number(body.amountUsd),
  });
  return NextResponse.json(result);
});
