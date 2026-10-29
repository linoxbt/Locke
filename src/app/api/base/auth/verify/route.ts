import { NextResponse } from "next/server";
import { setBaseSessionCookie, signInBaseUser } from "@/lib/server/baseSession";
import { HttpError } from "@/lib/server/errors";
import { readJson, route, str } from "@/lib/server/http";
import { assertSameOrigin } from "@/lib/server/session";
import { verifySignIn } from "@/lib/server/siwe";

/**
 * Step 2: check the signed Sign-In with Ethereum message (this site, Base, fresh, single-use
 * nonce, and a signature from that address, smart wallets included), then start a session.
 */
export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const host = req.headers.get("host");
  if (!host) throw new HttpError(400, "Missing host");
  const body = await readJson(req);
  const address = await verifySignIn({ message: str(body, "message", 4096), signature: str(body, "signature", 20_000) }, host);
  const user = await signInBaseUser(address);
  const res = NextResponse.json({ address: user.address });
  setBaseSessionCookie(res, { uid: user.id, addr: user.address, v: user.session_version });
  return res;
});
