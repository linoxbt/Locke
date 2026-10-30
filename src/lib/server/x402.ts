// x402 for Locke's agent API: an agent pays per call in USDC on Base by signing a transfer
// authorization (EIP-3009) and retrying with it; the payment settles on Base only after the call
// succeeds. Locke runs its own facilitator by default (it checks the signed authorization and
// submits it from a small gas wallet, X402_SETTLER_PRIVATE_KEY), or uses a hosted one
// (X402_FACILITATOR_URL). Payments go to X402_PAY_TO.

import { x402Facilitator } from "@x402/core/facilitator";
import { x402HTTPResourceServer, type HTTPAdapter, type HTTPRequestContext, type HTTPResponseInstructions } from "@x402/core/http";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { NextResponse } from "next/server";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { AGENT_ENDPOINTS, BASE_NETWORK } from "../agent/catalog";
import { config } from "./config";

type Handler = (req: Request, ctx: never) => Promise<Response>;

let ready: Promise<x402HTTPResourceServer | null> | null = null;

/** The payment layer, built once per process; null when the agent API isn't configured. */
function server(): Promise<x402HTTPResourceServer | null> {
  ready ??= build().catch((e) => {
    ready = null; // retry on the next request
    throw e;
  });
  return ready;
}

async function build(): Promise<x402HTTPResourceServer | null> {
  const payTo = config.x402PayTo;
  if (!payTo) return null;
  let facilitator;
  if (config.x402FacilitatorUrl) {
    facilitator = new HTTPFacilitatorClient({ url: config.x402FacilitatorUrl });
  } else {
    const key = config.x402SettlerKey;
    if (!key) return null;
    const account = privateKeyToAccount(key);
    const wallet = createWalletClient({ account, chain: base, transport: http(config.baseRpcUrl) }).extend(publicActions);
    const local = registerExactEvmScheme(new x402Facilitator(), {
      signer: toFacilitatorEvmSigner({ ...wallet, address: account.address } as never, { confirmationTimeoutMs: 20_000 }),
      networks: BASE_NETWORK,
    });
    facilitator = { verify: local.verify.bind(local), settle: local.settle.bind(local), getSupported: async () => local.getSupported() };
  }
  const resources = new x402ResourceServer(facilitator as never).register(BASE_NETWORK, new ExactEvmScheme());
  const routes = Object.fromEntries(
    AGENT_ENDPOINTS.filter((e) => e.price).map((e) => [
      `${e.method} ${e.path}`,
      { accepts: { scheme: "exact", network: BASE_NETWORK, payTo, price: e.price! }, description: e.what, mimeType: "application/json" },
    ])
  );
  const httpServer = new x402HTTPResourceServer(resources, routes as never);
  await httpServer.initialize();
  return httpServer;
}

function adapter(req: Request): HTTPAdapter {
  const url = new URL(req.url);
  return {
    getHeader: (name) => req.headers.get(name) ?? undefined,
    getMethod: () => req.method,
    getPath: () => url.pathname,
    getUrl: () => req.url,
    getAcceptHeader: () => req.headers.get("accept") ?? "",
    getUserAgent: () => req.headers.get("user-agent") ?? "",
    getQueryParams: () => Object.fromEntries(url.searchParams.entries()),
    getQueryParam: (name) => url.searchParams.get(name) ?? undefined,
  };
}

function toResponse(r: HTTPResponseInstructions): Response {
  const body = r.body === undefined ? null : typeof r.body === "string" ? r.body : JSON.stringify(r.body);
  return new Response(body, { status: r.status, headers: { "Content-Type": r.isHtml ? "text/html" : "application/json", ...r.headers } });
}

/**
 * Wrap a route handler so it needs an x402 payment. Without one the agent gets 402 and the price;
 * with a valid one the handler runs, and the payment settles only if it answered under 400.
 */
export function paid<H extends Handler>(handler: H): H {
  return (async (req: Request, ctx: never) => {
    let srv: x402HTTPResourceServer | null;
    try {
      srv = await server();
    } catch (e) {
      console.error("[x402]", e);
      srv = null;
    }
    if (!srv) return NextResponse.json({ error: "Locke's agent API isn't live yet." }, { status: 503 });

    const url = new URL(req.url);
    const context: HTTPRequestContext = {
      adapter: adapter(req),
      path: url.pathname,
      method: req.method,
      paymentHeader: req.headers.get("payment-signature") ?? req.headers.get("x-payment") ?? undefined,
    };
    const result = await srv.processHTTPRequest(context);
    if (result.type === "payment-error") return toResponse(result.response);
    if (result.type === "no-payment-required") return handler(req, ctx);

    let res: Response;
    try {
      res = await handler(req, ctx);
    } catch (e) {
      await result.cancellationDispatcher.cancel({ reason: "handler_threw", error: e }).catch(() => {});
      throw e;
    }
    if (res.status >= 400) {
      await result.cancellationDispatcher.cancel({ reason: "handler_failed", responseStatus: res.status }).catch(() => {});
      return res;
    }
    const settled = await srv.processSettlement(result.paymentPayload, result.paymentRequirements, result.declaredExtensions, { request: context }, undefined, result.beforeHandlerSettlement);
    if (!settled.success) return toResponse(settled.response);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(settled.headers)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  }) as H;
}
