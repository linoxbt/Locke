import { createPublicClient, http, type PublicClient } from "viem";
import { base } from "viem/chains";
import { config } from "./config";

let client: PublicClient | null = null;
let clientUrl = "";

/** Reads on Base (receipts, vault state, smart-wallet signature checks). */
export function basePublicClient(): PublicClient {
  const url = config.baseRpcUrl;
  if (!client || clientUrl !== url) {
    // Reads made together (a vault's state, the dashboard's figures) go out as one Multicall3 call,
    // and JSON-RPC requests in the same tick share one HTTP request: far fewer calls to the RPC.
    client = createPublicClient({
      chain: base,
      batch: { multicall: { wait: 16 } },
      transport: http(url, { timeout: 10_000, retryCount: 2, batch: { wait: 16 } }),
    }) as PublicClient;
    clientUrl = url;
  }
  return client;
}
