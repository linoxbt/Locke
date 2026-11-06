import { NextResponse } from "next/server";
import { currentBaseSession, requireBaseSession } from "@/lib/server/baseSession";
import { addVaultEvent, listVaults, recordVault } from "@/lib/server/baseVaults";
import { HttpError } from "@/lib/server/errors";
import { clientIp, readJson, route, str } from "@/lib/server/http";
import { ipBucket, rateLimit } from "@/lib/server/rateLimit";

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
  const saved = await recordVault(s, str(body, "txHash", 66), body.inputs, "app", ipBucket(clientIp(req)));
  // Plans opened from a partner's "Protect this position" link are attributed to it.
  const ref = typeof body.ref === "string" && /^[a-z0-9][a-z0-9._-]{1,31}$/.test(body.ref) ? body.ref : null;
  if (ref) await addVaultEvent(saved.address, "info", `Plan started from ${ref}`, { ref }).catch(() => null);
  return NextResponse.json(saved);
});
