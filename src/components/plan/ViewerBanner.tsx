import type { PlanType } from "@/lib/domain/types";
import { Arrow, LinkButton } from "../ui";

/** Shown to anyone reading a plan they don't own (a shared link): it's read-only, and here's how to get one. */
export function ViewerBanner({ type, signedIn }: { type: PlanType; signedIn: boolean }) {
  const start = `/protect/${type}`;
  return (
    <div className="mb-6 flex flex-col gap-4 rounded-[14px] bg-ink p-5 text-paper sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="eyebrow text-lime">Shared plan · read-only</div>
        <p className="mt-2 text-[14px] leading-relaxed text-paper/80">
          You&apos;re viewing someone&apos;s Locke plan. The numbers are live from Strike; only its owner can fund, change or close it.
        </p>
      </div>
      <LinkButton href={signedIn ? start : `/connect?next=${encodeURIComponent(start)}`} variant="paper" className="shrink-0">
        Protect your own <Arrow />
      </LinkButton>
    </div>
  );
}
