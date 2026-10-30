import { NextResponse } from "next/server";
import { AGENT_ENDPOINTS, BASE_NETWORK } from "@/lib/agent/catalog";
import { BASE_MARKETS } from "@/lib/base/contracts";
import { config } from "@/lib/server/config";
import { route } from "@/lib/server/http";

/** Free discovery for agents: what Locke's API does, what each call costs, and how to pay. */
export const GET = route(async (req: Request) => {
  const origin = new URL(req.url).origin;
  const live = !!config.x402PayTo && !!(config.x402FacilitatorUrl || config.x402SettlerKey);
  return NextResponse.json({
    name: "Locke",
    description: "Protection vaults on Base: hedge a crypto treasury or a fuel budget on Avantis, from a vault the business owns.",
    live,
    vaultsLive: !!config.baseFactoryAddress,
    payment: { protocol: "x402", version: 2, scheme: "exact", network: BASE_NETWORK, asset: "USDC", payTo: config.x402PayTo },
    markets: BASE_MARKETS.map((m) => ({ market: m.asset, symbol: m.symbol, plan: m.type, hedge: m.buy ? "long" : "short" })),
    endpoints: AGENT_ENDPOINTS.map((e) => ({ ...e, url: origin + e.path, price: e.price ?? "free" })),
    docs: origin + "/agents",
  });
});
