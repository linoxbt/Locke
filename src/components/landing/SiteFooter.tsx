import Link from "next/link";
import { LEGAL_DOCS } from "@/lib/legal";
import { CookieSettingsLink } from "../CookieConsent";
import { LockeLogoReverse } from "../Logo";

const COLUMNS: { title: string; links: [string, string][] }[] = [
  { title: "Locke on Base", links: [["Sign in with Base", "/base"], ["New vault", "/base/new"]] },
  { title: "Product", links: [["How it works", "/how-it-works"], ["Holdings plan", "/how-it-works#holdings"], ["Operating costs plan", "/how-it-works#costs"]] },
  { title: "On Cardano", links: [["Connect a wallet", "/connect"], ["Protect your ADA", "/protect/holdings"], ["Manage fuel costs", "/protect/costs"], ["Portfolio", "/portfolio"]] },
  { title: "Legal", links: LEGAL_DOCS.map((d) => [d.label, d.href] as [string, string]) },
];

export function SiteFooter() {
  return (
    <footer className="bg-ink text-paper">
      <div className="mx-auto max-w-[1440px] px-5 pt-14 sm:px-14">
        <LockeLogoReverse height={28} />
      </div>
      <div className="mx-auto grid max-w-[1440px] grid-cols-2 gap-x-6 gap-y-10 px-5 pb-10 pt-10 sm:px-14 md:grid-cols-5">
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
            Protection vaults for businesses on Base, hedged on Veranta. Also on Cardano with Strike Finance. A tool, not financial advice.
          </p>
        </div>
      </div>
      <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-5 pb-10 text-[13px] text-paper/55 sm:flex-row sm:justify-between sm:px-14">
        <span>Hedges can lose money on their own, and positions can be liquidated if margin runs out.</span>
        <span>Check Veranta&apos;s and Strike&apos;s eligibility rules before you use them.</span>
      </div>
    </footer>
  );
}
