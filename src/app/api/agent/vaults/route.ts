import { NextResponse } from "next/server";
import { agentInputs } from "@/lib/server/agent";
import { signInBaseUser } from "@/lib/server/baseSession";
import { recordVault, vaultCreator } from "@/lib/server/baseVaults";
import { clientIp, readJson, route, str } from "@/lib/server/http";
import { ipBucket, rateLimit } from "@/lib/server/rateLimit";

/**
 * Register a vault from its creation transaction. Free: the transaction itself proves who owns the
 * vault (the factory's VaultCreated event names the sender), and its limits must match the inputs.
 */
export const POST = route(async (req: Request) => {
  rateLimit(`${ipBucket(clientIp(req)) ?? "anon"}:agent-register`, 10);
  const body = await readJson(req);
  const txHash = str(body, "txHash", 66, /^0x[0-9a-fA-F]{64}$/);
  const owner = await vaultCreator(txHash);
  const user = await signInBaseUser(owner.toLowerCase());
  const raw = typeof body.inputs === "object" && body.inputs ? (body.inputs as Record<string, unknown>) : body;
  const { address } = await recordVault({ uid: user.id, addr: user.address }, txHash, agentInputs(raw));
  return NextResponse.json({ address, status: new URL(`/api/agent/vaults/${address}`, req.url).toString() });
});
