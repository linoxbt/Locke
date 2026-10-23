import type { Metadata } from "next";
import Link from "next/link";
import { CREATE_STEPS, Crumbs } from "@/components/Crumbs";
import { DropIn } from "@/components/DropIn";
import { Arrow, Card, Display, Eyebrow, SUBTLE } from "@/components/ui";
import { requirePageSession } from "@/lib/server/pageAuth";

export const metadata: Metadata = { title: "New plan — Locke" };

export default async function ProtectPage() {
  await requirePageSession("/protect");
  return (
    <div className="animate-rise">
      <Crumbs steps={CREATE_STEPS} current={0} />
      <Display lead="What do you want to protect?" rest="Pick one. You can add the other later." className="max-w-[16ch]" />
      <DropIn className="mt-8 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Choice href="/protect/holdings" tone="cobalt" n="01" title="Holdings" line="Protect what your business holds" body="A fall in the value of ADA in your treasury. Direct hedge on ADA-USD." />
        <Choice href="/protect/costs" tone="lime" n="02" title="Operating costs" line="Manage what it needs to buy" body="A rise in what you pay for diesel or petrol. Partial hedge on WTI crude." />
      </DropIn>
    </div>
  );
}

function Choice({ href, tone, n, title, line, body }: { href: string; tone: "cobalt" | "lime"; n: string; title: string; line: string; body: string }) {
  return (
    <Link href={href} className="group">
      <Card tone={tone} className="flex min-h-[188px] flex-col transition-transform duration-300 group-hover:-translate-y-1 sm:min-h-[202px]">
        <div className="flex items-center justify-between">
          <Eyebrow className={SUBTLE[tone]}>
            {n} · {title}
          </Eyebrow>
          <span className={`grid h-12 w-12 place-items-center rounded-full transition-transform duration-300 group-hover:rotate-[-45deg] ${tone === "cobalt" ? "bg-paper text-cobalt" : "bg-ink text-lime"}`}>
            <Arrow />
          </span>
        </div>
        <span className="display mt-auto block pt-8 text-[24px] sm:text-[28px]">{line}</span>
        <span className={`mt-4 block max-w-[40ch] text-[14px] ${SUBTLE[tone]}`}>{body}</span>
      </Card>
    </Link>
  );
}
