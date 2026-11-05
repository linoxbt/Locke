import { NextResponse } from "next/server";
import { currentBaseSession } from "@/lib/server/baseSession";
import { HttpError, shortError } from "@/lib/server/errors";
import { route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { heldStocks } from "@/lib/server/tokenizedStocks";

/** Tokenized stocks the signed-in account holds on Base that a stock plan can protect. */
export const GET = route(async () => {
  const s = await currentBaseSession();
  if (!s) throw new HttpError(401, "Not signed in");
  rateLimit(`${s.uid}:stock-holdings`, 20);
  const holdings = await heldStocks(s.addr).catch((e) => {
    console.warn("[stocks] couldn't read holdings:", shortError(e));
    return [];
  });
  return NextResponse.json({ holdings });
});
