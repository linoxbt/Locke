import { NextResponse } from "next/server";
import { currentBaseSession } from "@/lib/server/baseSession";
import { vaultDetail } from "@/lib/server/baseVaults";
import { HttpError } from "@/lib/server/errors";
import { route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";

/** A vault's live state for its owner (polled by the vault page). */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ address: string }> }) => {
  const s = await currentBaseSession();
  if (!s) throw new HttpError(401, "Not signed in");
  // The page polls every 10 s; each read costs several Base and Avantis calls.
  rateLimit(`${s.uid}:base-vault`, 60);
  const { address } = await ctx.params;
  return NextResponse.json(await vaultDetail(s.uid, address), { headers: { "Cache-Control": "no-store" } });
});
