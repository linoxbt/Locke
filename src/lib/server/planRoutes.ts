import { notFound, redirect } from "next/navigation";
import type { PlanStatus } from "../domain/types";
import { db } from "./db";
import { HttpError } from "./errors";
import { optionalSession, requirePageSession } from "./pageAuth";
import { loadPlan, loadSharedPlan, type PlanRow } from "./planService";

/** Where a plan in this status should be looked at. */
export function homeFor(plan: Pick<PlanRow, "id" | "status">): string {
  const base = `/plans/${plan.id}`;
  if (plan.status === "draft") return `${base}/preview`;
  if (plan.status === "funding" || plan.status === "opening") return `${base}/fund`;
  return base;
}

/** Where someone who doesn't own a plan looks at it: the read-only pages only. */
export function viewHomeFor(plan: Pick<PlanRow, "id" | "status">): string {
  const base = `/plans/${plan.id}`;
  if (plan.status === "draft" || plan.status === "funding") return `${base}/preview`;
  if (plan.status === "opening") return `${base}/activity`;
  return base;
}

/**
 * Load a plan for a page and enforce which statuses the page serves; anything else is
 * redirected to the page that fits the plan right now.
 *
 * `view` pages (overview, preview, replay, activity, Strike details) can be read through a shared
 * link without owning the plan: read-only, signed in or not. Action pages stay the owner's.
 */
export async function planForPage(id: string, page: string, allowed: PlanStatus[], opts: { view?: boolean } = {}): Promise<PlanRow> {
  const notFoundOn404 = (e: unknown): never => {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  };
  if (opts.view) {
    const s = await optionalSession();
    const plan = await loadSharedPlan(id).catch(notFoundOn404);
    const owner = !!s && s.uid === plan.user_id;
    if (!allowed.includes(plan.status)) redirect(owner ? homeFor(plan) : viewHomeFor(plan));
    return plan;
  }
  const s = await requirePageSession(`/plans/${id}${page}`);
  let plan: PlanRow;
  try {
    plan = await loadPlan(s.uid, id);
  } catch (e) {
    // Not theirs: a shared plan is still readable on its view pages.
    const shared = await loadSharedPlan(id).catch(() => null);
    if (shared) redirect(viewHomeFor(shared));
    return notFoundOn404(e);
  }
  if (!allowed.includes(plan.status)) redirect(homeFor(plan));
  return plan;
}

/**
 * True while an opening deposit is on its way to Strike: confirmed to Strike, or sent on Cardano
 * (it has a transaction hash) while Strike's confirmation failed. Either way the ADA has left the
 * wallet, so the user must not be asked to deposit again.
 */
export async function hasDepositInFlight(planId: string): Promise<boolean> {
  const [row] = await db()`select 1 from deposits where plan_id = ${planId} and purpose = 'open'
                           and (status = 'submitted' or (status = 'built' and tx_hash is not null)) limit 1`;
  return !!row;
}
