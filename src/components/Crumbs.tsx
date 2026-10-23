import Link from "next/link";
import { Arrow } from "./ui";

/** Back link + step trail. Server-safe. */
export function Crumbs({ back, steps, current }: { back?: { href: string; label: string }; steps?: string[]; current?: number }) {
  return (
    <div className="mb-8 space-y-4">
      {steps && current != null && (
        <ol className="flex gap-1.5" aria-label="Progress">
          {steps.map((l, k) => (
            <li key={l} className="flex-1" aria-current={k === current ? "step" : undefined}>
              <div className={`h-1 rounded-full ${k <= current ? "bg-ink" : "bg-line"}`} />
              <span className={`eyebrow mt-2 block ${k <= current ? "text-ink" : "text-ink-3"}`}>{l}</span>
            </li>
          ))}
        </ol>
      )}
      {back && (
        <Link href={back.href} className="inline-flex h-10 items-center gap-2 rounded-full bg-paper px-4 text-[13px] text-ink-2 hover:text-ink">
          <Arrow className="rotate-180" /> {back.label}
        </Link>
      )}
    </div>
  );
}

export const CREATE_STEPS = ["Protect", "Describe", "Preview", "Fund"];
