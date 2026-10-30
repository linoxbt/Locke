// Locke's agent API: what each endpoint does and what it costs. Paid endpoints take an x402
// payment in USDC on Base; the rest are free. Shared by the routes, the discovery endpoint and the
// /agents page so they can't disagree.

export const BASE_NETWORK = "eip155:8453" as const;

export interface AgentEndpoint {
  method: "GET" | "POST";
  path: string;
  /** x402 price in USD, or null when free. */
  price: `$${string}` | null;
  what: string;
}

export const AGENT_ENDPOINTS: AgentEndpoint[] = [
  {
    method: "GET",
    path: "/api/agent/quote",
    price: "$0.01",
    what: "Size a protection plan on Base from live Avantis prices: hedge, deposit, margin, fees, limits and daily carry.",
  },
  {
    method: "POST",
    path: "/api/agent/plan",
    price: "$0.05",
    what: "The wallet calls that create the owner's own Locke vault with the plan's limits and deposit (USDC approval + createVault), ready to send in one batch.",
  },
  {
    method: "POST",
    path: "/api/agent/vaults",
    price: null,
    what: "Register a vault after its creation transaction confirms, so Locke's keeper opens and watches its hedge.",
  },
  {
    method: "GET",
    path: "/api/agent/vaults/{address}",
    price: null,
    what: "A vault's status: plan, amount protected, and its Protected by Locke proof once the hedge is open.",
  },
];
