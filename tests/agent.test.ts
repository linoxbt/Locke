import { afterEach, describe, expect, it } from "vitest";
import { AGENT_ENDPOINTS } from "@/lib/agent/catalog";
import { agentInputs } from "@/lib/server/agent";
import { HttpError } from "@/lib/server/errors";
import { paid } from "@/lib/server/x402";

describe("agent API", () => {
  it("takes a market symbol instead of a pair index, with sensible defaults", () => {
    expect(agentInputs({ market: "eth", valueUsd: "1000", sharePct: "50" })).toEqual({ type: "holdings", pairIndex: 0, valueUsd: 1000, sharePct: 50, leverage: 2, bufferPct: 50 });
    expect(agentInputs({ market: "WTI", monthlySpendUsd: 500, months: 3, crudeSharePct: 60, leverage: 1 })).toMatchObject({ type: "costs", pairIndex: 96, leverage: 1 });
  });

  it("refuses unknown markets and bad inputs with a 400 the agent can read", () => {
    for (const bad of [{ market: "DOGE", valueUsd: 100, sharePct: 50 }, { market: "ETH", valueUsd: 100, sharePct: 5 }, { market: "ETH", valueUsd: 100, sharePct: 50, leverage: 9 }]) {
      try {
        agentInputs(bad);
        throw new Error("accepted " + JSON.stringify(bad));
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).status).toBe(400);
      }
    }
  });

  it("prices the paid endpoints in dollars and leaves registration and status free", () => {
    const priced = AGENT_ENDPOINTS.filter((e) => e.price).map((e) => `${e.method} ${e.path} ${e.price}`);
    expect(priced).toEqual(["GET /api/agent/quote $0.01", "POST /api/agent/plan $0.05"]);
  });

  describe("without payment settings", () => {
    const saved = { payTo: process.env.X402_PAY_TO, key: process.env.X402_SETTLER_PRIVATE_KEY };
    afterEach(() => {
      process.env.X402_PAY_TO = saved.payTo;
      process.env.X402_SETTLER_PRIVATE_KEY = saved.key;
    });

    it("answers 503 and never runs the handler", async () => {
      delete process.env.X402_PAY_TO;
      let ran = false;
      const handler = paid(async (_req: Request, _ctx: never) => {
        ran = true;
        return new Response("{}");
      });
      const res = await handler(new Request("http://localhost/api/agent/quote?market=ETH"), undefined as never);
      expect(res.status).toBe(503);
      expect(ran).toBe(false);
    });
  });
});
