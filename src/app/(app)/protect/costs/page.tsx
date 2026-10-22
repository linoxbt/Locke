import type { Metadata } from "next";
import { CREATE_STEPS, Crumbs } from "@/components/Crumbs";
import { PlanForm } from "@/components/protect/PlanForm";
import { requirePageSession } from "@/lib/server/pageAuth";
import { getMarkPrice } from "@/lib/strike/client";

export const metadata: Metadata = { title: "Manage your fuel costs — Locke" };

export default async function Page() {
  await requirePageSession("/protect/costs");
  const [ada, wti] = await Promise.allSettled([getMarkPrice("ADA-USD"), getMarkPrice("WTI-USD")]);
  return (
    <div className="animate-rise">
      <Crumbs steps={CREATE_STEPS} current={1} back={{ href: "/protect", label: "What to protect" }} />
      <PlanForm
        type="costs"
        adaPrice={ada.status === "fulfilled" ? ada.value.mark : null}
        wtiPrice={wti.status === "fulfilled" ? wti.value.mark : null}
      />
    </div>
  );
}
