import Link from "next/link";
import { contactEmail, LEGAL, LEGAL_DOCS } from "@/lib/legal";

/** A legal document: title, date, the other documents beside it, and readable long-form text. */
export function LegalPage({ path, title, lead, children }: { path: string; title: string; lead: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[220px_1fr] lg:gap-14">
      <nav aria-label="Legal documents" className="lg:sticky lg:top-24 lg:h-fit">
        <div className="eyebrow mb-3">Legal</div>
        <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
          {LEGAL_DOCS.map((d) => (
            <li key={d.href}>
              <Link
                href={d.href}
                aria-current={d.href === path ? "page" : undefined}
                className={`inline-flex h-9 items-center rounded-full px-3.5 text-[14px] transition-colors ${d.href === path ? "bg-ink text-paper" : "bg-paper text-ink hover:bg-mist"}`}
              >
                {d.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <article className="max-w-[760px] rounded-[var(--radius-card)] bg-paper p-6 sm:p-10">
        <h1 className="display text-[30px] sm:text-[40px]">{title}</h1>
        <p className="num mt-2 text-[13px] text-ink-3">Last updated {LEGAL.updated}</p>
        <div className="mt-6 text-[16px] leading-relaxed text-ink-2">{lead}</div>
        <div className="legal mt-8">{children}</div>
        <p className="mt-12 border-t border-line pt-6 text-[14px] text-ink-2">
          Questions about this document: <span className="num text-ink">{contactEmail()}</span>.
        </p>
      </article>
    </div>
  );
}
