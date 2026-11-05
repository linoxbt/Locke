import Link from "next/link";
import { LEGAL_DOCS } from "@/lib/legal";
import { CookieSettingsLink } from "../CookieConsent";
import { LockeLogoReverse } from "../Logo";

const COLUMNS: { title: string; links: [string, string][] }[] = [
  {
    title: "Plans",
    links: [
      ["Sign in with Base", "/connect"],
      ["Portfolio", "/portfolio"],
      ["Protect your holdings", "/protect/holdings"],
      ["Protect your stocks", "/protect/stocks"],
      ["Manage fuel costs", "/protect/costs"]
    ]
  },
  {
    title: "Product",
    links: [
      ["How it works", "/how-it-works"],
      ["Holdings plan", "/how-it-works#holdings"],
      ["Stocks plan", "/how-it-works#stocks"],
      ["Operating costs plan", "/how-it-works#costs"],
      ["Metrics", "/metrics"],
      ["For agents", "/agents"]
    ]
  },
  { title: "Legal", links: LEGAL_DOCS.map((d) => [d.label, d.href] as [string, string]) },
];

export function SiteFooter() {
  return (
    <footer className="bg-ink text-paper">
      <div className="mx-auto max-w-[1440px] px-5 pt-14 sm:px-14">
        <LockeLogoReverse height={28} />
      </div>
      <div className="mx-auto grid max-w-[1440px] grid-cols-2 gap-x-6 gap-y-10 px-5 pb-10 pt-10 sm:px-14 md:grid-cols-4">
        {COLUMNS.map((c) => (
          <div key={c.title}>
            <h2 className="text-[15px]">{c.title}</h2>
            <ul className="mt-3 space-y-2">
              {c.links.map(([label, href]) => (
                <li key={href}>
                  <Link href={href} className="text-[15px] text-paper/50 transition-colors hover:text-paper">
                    {label}
                  </Link>
                </li>
              ))}
              {c.title === "Legal" && (
                <li>
                  <CookieSettingsLink className="text-[15px] text-paper/50 transition-colors hover:text-paper" />
                </li>
              )}
            </ul>
          </div>
        ))}
        <div className="col-span-2 md:col-span-1">
          <h2 className="text-[15px]">Locke</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-paper/50">
            Protection plans for businesses on Base, for the crypto and tokenized stocks they hold and the fuel they buy, hedged on Veranta from a
            vault each business owns. A tool, not financial advice.
          </p>
        </div>
      </div>
      <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-5 pb-10 text-[13px] text-paper/55 sm:flex-row sm:justify-between sm:px-14">
        <span>Hedges can lose money on their own, and positions can be liquidated if margin runs out.</span>
        <span>Check Veranta&apos;s eligibility rules before you use it. Stock plans aren&apos;t available to US persons.</span>
      </div>
    </footer>
  );
}
