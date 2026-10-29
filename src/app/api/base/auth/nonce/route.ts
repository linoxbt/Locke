import { NextResponse } from "next/server";
import { clientIp, route } from "@/lib/server/http";
import { ipBucket } from "@/lib/server/rateLimit";
import { assertSameOrigin } from "@/lib/server/session";
import { issueNonce } from "@/lib/server/siwe";

/** Step 1 of Sign in with Base: a single-use nonce the wallet signs into its message. */
export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const nonce = await issueNonce(ipBucket(clientIp(req)));
  return NextResponse.json({ nonce }, { headers: { "Cache-Control": "no-store" } });
});
