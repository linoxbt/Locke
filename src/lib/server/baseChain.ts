import { createPublicClient, http, type PublicClient } from "viem";
import { base } from "viem/chains";
import { config } from "./config";

let client: PublicClient | null = null;
let clientUrl = "";

/** Reads on Base (receipts, vault state, smart-wallet signature checks). */
export function basePublicClient(): PublicClient {
  const url = config.baseRpcUrl;
  if (!client || clientUrl !== url) {
    client = createPublicClient({ chain: base, transport: http(url, { timeout: 10_000, retryCount: 2 }) }) as PublicClient;
    clientUrl = url;
  }
  return client;
}
