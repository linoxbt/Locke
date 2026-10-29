import Link from "next/link";
import { LEGAL_DOCS } from "@/lib/legal";
import { CookieSettingsLink } from "../CookieConsent";

/** The legal links and cookie settings, at the foot of app pages (the landing has its own footer). */
export function LegalFooter() {
  return (
    <footer className="mx-auto w-full max-w-[1240px] px-4 pb-10 sm:px-6">
      <div className="flex flex-col gap-3 border-t border-line pt-6 text-[13px] text-ink-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
          {LEGAL_DOCS.map((d) => (
            <Link key={d.href} href={d.href} className="hover:text-ink">
              {d.label}
            </Link>
          ))}
          <CookieSettingsLink className="hover:text-ink" />
        </nav>
        <span>Locke is a tool, not financial advice. Hedges can lose money.</span>
      </div>
    </footer>
  );
}
