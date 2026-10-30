import { NextResponse } from "next/server";
import { currentBaseSession, requireBaseSession } from "@/lib/server/baseSession";
import { listVaults, recordVault } from "@/lib/server/baseVaults";
import { HttpError } from "@/lib/server/errors";
import { readJson, route, str } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";

export const GET = route(async () => {
  const s = await currentBaseSession();
  if (!s) throw new HttpError(401, "Not signed in");
  rateLimit(`${s.uid}:base-vaults`, 60);
  return NextResponse.json({ vaults: await listVaults(s.uid) });
});

/** Record the vault the signed-in business just created, from its creation transaction. */
export const POST = route(async (req: Request) => {
  const s = await requireBaseSession(req);
  rateLimit(`${s.uid}:base-record`, 20);
  const body = await readJson(req);
  return NextResponse.json(await recordVault(s, str(body, "txHash", 66), body.inputs));
});
