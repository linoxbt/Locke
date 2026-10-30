import { NextResponse } from "next/server";
import { agentInputs, quote } from "@/lib/server/agent";
import { clientIp, route } from "@/lib/server/http";
import { ipBucket, rateLimit } from "@/lib/server/rateLimit";
import { paid } from "@/lib/server/x402";

/** Size a protection plan from live Avantis prices. Paid per call with x402. */
export const GET = paid(
  route(async (req: Request) => {
    rateLimit(`${ipBucket(clientIp(req)) ?? "anon"}:agent-quote`, 60);
    const params = Object.fromEntries(new URL(req.url).searchParams.entries());
    return NextResponse.json(await quote(agentInputs(params)));
  })
);
