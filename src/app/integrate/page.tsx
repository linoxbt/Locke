import type { Metadata } from "next";
import { configuredSiteUrl } from "@/lib/ui/site";
import { Card, Display, Eyebrow, LinkButton, Arrow } from "@/components/ui";
import { protectLink } from "@/lib/base/prefill";

export const metadata: Metadata = {
  title: "Integrate Locke",
  description: "Let your users protect what they hold or buy, from your exchange, wallet or AI agent: a Protect this position link, and a Locke skill for Bankr agents.",
};
export const dynamic = "force-dynamic";

const SKILL_REPO = "https://github.com/linoxbt/Locke/tree/locke-preview/public/skills/locke";

const PARAMS: [string, string][] = [
  ["asset", "Ticker of the stock, index or coin: NVDA, AAPL, US500, ETH, BTC, WTI, BRENT. A tokenized-stock token works too (NVDAc)."],
  ["value", "Value held, in US dollars."],
  ["shares", "Or the number of shares or coins held; Locke prices them live."],
  ["share", "Share of it to protect, 10–100 (default 50)."],
  ["product, monthly, months", "Oil plans: what's bought (crude, diesel, petrol, jet, marine, heating, lpg, asphalt, petrochemicals), the monthly spend and months to cover (1–6)."],
  ["ref", "Your name, e.g. o1. Plans started from your link are tagged with it."],
];

const button = (href: string, site: string) => `<a href="${href}"
   style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:999px;
          background:#0C0C0D;color:#FFFFFF;font:500 14px/20px Inter,system-ui,sans-serif;text-decoration:none">
  <img src="${site}/brand/email/locke-icon@2x.png" width="20" height="20" alt="" style="border-radius:5px">
  Protect with Locke
</a>`;

export default async function IntegratePage() {
  // Links partners copy always name Locke's public address, wherever this page is served from.
  const site = (configuredSiteUrl() ?? new URL("https://rebase.trylocke.online")).origin;
  const nvda = protectLink(site, "stocks", { asset: "NVDA", shares: 25, ref: "o1" });
  const eth = protectLink(site, "holdings", { asset: "ETH", value: 20000, share: 40, ref: "o1" });
  const oil = `${site}/protect/costs?asset=WTI&product=diesel&monthly=12000&months=3&ref=o1`;
  return (
    <div className="flex flex-col gap-6">
      <Eyebrow className="text-ink-2">For exchanges, wallets and agents</Eyebrow>
      <Display lead="Integrate Locke." rest="Let your users protect what they hold or buy, without leaving the flow they're in." />

      <Card className="flex flex-col gap-5">
        <div>
          <Eyebrow className="text-ink-2">1 · Protect this position</Eyebrow>
          <h2 className="display mt-3 text-[22px]">One link from any holding</h2>
          <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-ink-2">
            Put a button next to a position in your app. It opens Locke&apos;s plan form already filled in with the stock or coin and the
            amount. Your user signs in with their wallet, reviews the hedge and creates a vault they own. Nothing to install and no API key.
          </p>
        </div>
        <ul className="flex flex-col divide-y divide-line rounded-2xl bg-canvas px-4">
          {PARAMS.map(([k, v]) => (
            <li key={k} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-6">
              <span className="num shrink-0 text-[13px] sm:w-[200px]">{k}</span>
              <span className="text-[14px] text-ink-2">{v}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] text-ink-2">Links, by plan:</span>
          {[
            ["Stocks", "/protect/stocks", nvda],
            ["Crypto", "/protect/holdings", eth],
            ["Oil", "/protect/costs", oil],
          ].map(([label, , href]) => (
            <a key={label} href={href} className="num block break-all rounded-xl bg-mist px-3 py-2 text-[12px] text-ink hover:bg-line">
              <span className="text-ink-3">{label} · </span>
              {href}
            </a>
          ))}
        </div>
        <div className="flex flex-col gap-3 rounded-2xl bg-ink p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Eyebrow className="text-lime">The button</Eyebrow>
            <a
              href={nvda}
              className="inline-flex items-center gap-2 rounded-full bg-paper px-4 py-2.5 text-[14px] font-medium text-ink"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/email/locke-icon@2x.png" width={20} height={20} alt="" className="rounded-[5px]" />
              Protect with Locke
            </a>
          </div>
          <pre className="num overflow-x-auto whitespace-pre text-[12px] leading-relaxed text-paper/85">{button(nvda, site)}</pre>
        </div>
      </Card>

      <Card className="flex flex-col gap-5">
        <div>
          <Eyebrow className="text-ink-2">2 · Bankr agents</Eyebrow>
          <h2 className="display mt-3 text-[22px]">A Locke skill for every agent</h2>
          <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-ink-2">
            An agent with a Bankr wallet can protect the tokenized stocks, ETH or BTC it holds, or its oil costs. The skill teaches it to
            quote a plan, send the two Base transactions that create its own vault, and register it with Locke&apos;s keeper. Quotes and plans
            are paid per call with x402 in USDC on Base.
          </p>
        </div>
        <div className="rounded-2xl bg-canvas p-4">
          <span className="text-[13px] text-ink-2">Tell your Bankr agent:</span>
          <p className="num mt-2 break-all text-[13px] text-ink">install the locke skill from {SKILL_REPO}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <LinkButton href="/skills/locke/SKILL.md" variant="ghost">
            Read the skill <Arrow />
          </LinkButton>
          <LinkButton href="/agents" variant="ghost">
            Agent API <Arrow />
          </LinkButton>
        </div>
      </Card>

      <p className="text-[13px] leading-relaxed text-ink-3">
        Every plan is the user&apos;s own vault on Base: Locke never holds their funds, and only they can withdraw or close. Hedges can lose
        money; your users should read the Risk Disclosure. Stock plans aren&apos;t available to US persons. Questions or a partnership:
        alemzdelight@gmail.com.
      </p>
    </div>
  );
}
