import { NextResponse } from "next/server";
import { proofPath } from "@/lib/base/attest";
import { baseMarket } from "@/lib/base/contracts";
import { activeAttestation } from "@/lib/server/baseVaults";
import { db } from "@/lib/server/db";
import { HttpError } from "@/lib/server/errors";
import { clientIp, route } from "@/lib/server/http";
import { ipBucket, rateLimit } from "@/lib/server/rateLimit";

/** A vault's status for agents. Free, and limited to what Base shows anyway (no internal risk notes). */
export const GET = route(async (req: Request, ctx: { params: Promise<{ address: string }> }) => {
  rateLimit(`${ipBucket(clientIp(req)) ?? "anon"}:agent-status`, 60);
  const { address } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new HttpError(404, "Vault not found");
  const vault = address.toLowerCase();
  const [row] = await db()`select pair_index, type, status, sizing, opened_at, closed_at from base_vaults where address = ${vault}`;
  if (!row) throw new HttpError(404, "Vault not found");
  const proof = await activeAttestation(vault);
  return NextResponse.json({
    address: vault,
    market: baseMarket(Number(row.pair_index))?.symbol,
    plan: row.type,
    status: row.status,
    protectedUsd: Number((row.sizing as { notionalUsd?: number }).notionalUsd ?? 0),
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    proof: proof ? new URL(proofPath(proof), req.url).toString() : null,
  });
});
