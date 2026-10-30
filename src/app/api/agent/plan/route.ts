import { NextResponse } from "next/server";
import { agentInputs, planCalls } from "@/lib/server/agent";
import { clientIp, readJson, route } from "@/lib/server/http";
import { ipBucket, rateLimit } from "@/lib/server/rateLimit";
import { paid } from "@/lib/server/x402";

/** The wallet calls that create the owner's vault for a plan. Paid per call with x402. */
export const POST = paid(
  route(async (req: Request) => {
    rateLimit(`${ipBucket(clientIp(req)) ?? "anon"}:agent-plan`, 30);
    const body = await readJson(req);
    return NextResponse.json(await planCalls(body.owner, agentInputs(body)));
  })
);
