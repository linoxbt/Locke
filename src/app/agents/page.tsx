import type { Metadata } from "next";
import { BaseMark } from "@/components/base/BaseMark";
import { Card, Display, Eyebrow } from "@/components/ui";
import { AGENT_ENDPOINTS } from "@/lib/agent/catalog";

export const metadata: Metadata = {
  title: "Locke for agents",
  description: "A pay-per-call API so AI agents and on-chain treasuries can quote and open Locke protection on Base, paid with x402 in USDC.",
};

const EXAMPLE = `import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";

const core = new x402Client();
registerExactEvmScheme(core, { signer: toClientEvmSigner(account, publicClient), networks: ["eip155:8453"] });
const client = new x402HTTPClient(core);

const url = "https://locke.example/api/agent/quote?market=ETH&valueUsd=10000&sharePct=50";
const first = await fetch(url);                       // 402: price and where to pay
const required = client.getPaymentRequiredResponse((h) => first.headers.get(h), await first.json());
const payment = await client.createPaymentPayload(required);   // signs a USDC transfer authorization
const quote = await fetch(url, { headers: client.encodePaymentSignatureHeader(payment) });
console.log(await quote.json());                      // settles on Base only because this succeeded`;

export default function AgentsPage() {
  return (
    <div className="flex flex-col gap-6">
      <Eyebrow className="flex items-center gap-2 text-ink-2">
        <BaseMark size={12} /> x402 · USDC on Base
      </Eyebrow>
      <Display lead="Locke for agents." rest="Quote and open protection from code. Pay per call, no account, no API key." />

      <Card className="flex flex-col gap-4">
        <Eyebrow className="text-ink-2">Endpoints</Eyebrow>
        <ul className="flex flex-col divide-y divide-line">
          {AGENT_ENDPOINTS.map((e) => (
            <li key={e.method + e.path} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-6">
              <span className="num shrink-0 text-[13px] sm:w-[300px]">
                <span className="text-ink-3">{e.method}</span> {e.path}
              </span>
              <span className="flex-1 text-[14px] text-ink-2">{e.what}</span>
              <span className={`num shrink-0 text-[13px] ${e.price ? "text-ink" : "text-ok"}`}>{e.price ?? "Free"}</span>
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-ink-3">
          Discovery: <span className="num">GET /api/agent</span> lists these with live prices and where payments go.
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {[
          ["1. Quote", "Ask for a plan: a treasury in ETH or BTC, or a fuel budget priced off WTI or Brent. Locke sizes the hedge from live Avantis prices and says what it costs to hold."],
          ["2. Open", "Locke returns the wallet calls that create the owner's own vault with the plan's limits and deposit. The owner's wallet sends them; Locke never holds the funds."],
          ["3. Register", "Send the creation transaction hash. Locke's keeper opens the hedge, adds margin when needed, and publishes a Protected by Locke proof on Base."],
        ].map(([t, d]) => (
          <Card key={t} tone="mist" className="flex flex-col gap-2">
            <h2 className="display text-[18px]">{t}</h2>
            <p className="text-[14px] leading-relaxed text-ink-2">{d}</p>
          </Card>
        ))}
      </div>

      <Card tone="ink" className="flex flex-col gap-3">
        <Eyebrow className="text-lime">Paying with x402</Eyebrow>
        <pre className="num overflow-x-auto whitespace-pre text-[12px] leading-relaxed text-paper/85">{EXAMPLE}</pre>
      </Card>

      <p className="text-[13px] leading-relaxed text-ink-3">
        A call is charged only when it succeeds: a bad request returns an error and the payment is never settled. Payments are USDC
        transfer authorizations (EIP-3009) on Base, settled to Locke after the response. Hedges can lose money; read the Risk Disclosure
        before opening one.
      </p>
    </div>
  );
}
