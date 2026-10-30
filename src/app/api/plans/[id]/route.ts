import { NextResponse } from "next/server";
import { clientIp, idParam, route } from "@/lib/server/http";
import { optionalSession } from "@/lib/server/pageAuth";
import { getPlanDetailFor } from "@/lib/server/queries";
import { ipBucket, LIMITS, rateLimit } from "@/lib/server/rateLimit";
import { assertSameOrigin } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** A plan's detail. Its owner gets everything; anyone else with the link gets the read-only copy. */
export const GET = route(async (req: Request, ctx: Ctx) => {
  const s = await optionalSession();
  if (s) {
    assertSameOrigin(req);
    // Signed in is not the same as owner: a shared link read by another account still spends the
    // owner's Strike allowance, so every account is limited (well above an owner's own polling).
    rateLimit(`${s.uid}:plan-view`, LIMITS.read * 4);
  } else rateLimit(`${ipBucket(clientIp(req)) ?? "anon"}:plan-view`, LIMITS.read);
  const id = idParam((await ctx.params).id, "Plan not found");
  const withPreview = new URL(req.url).searchParams.get("preview") !== "0";
  return NextResponse.json(await getPlanDetailFor(s?.uid ?? null, id, { withPreview }));
});
