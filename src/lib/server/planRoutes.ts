import { notFound, redirect } from "next/navigation";
import type { PlanStatus } from "../domain/types";
import { db } from "./db";
import { HttpError } from "./errors";
import { requirePageSession } from "./pageAuth";
import { loadPlan, type PlanRow } from "./planService";

/** Where a plan in this status should be looked at. */
export function homeFor(plan: Pick<PlanRow, "id" | "status">): string {
  const base = `/plans/${plan.id}`;
  if (plan.status === "draft") return `${base}/preview`;
  if (plan.status === "funding" || plan.status === "opening") return `${base}/fund`;
  return base;
}

/**
 * Load a plan for a page and enforce which statuses the page serves; anything else is
 * redirected to the page that fits the plan right now.
 */
export async function planForPage(id: string, page: string, allowed: PlanStatus[]): Promise<PlanRow> {
  const s = await requirePageSession(`/plans/${id}${page}`);
  let plan: PlanRow;
  try {
    plan = await loadPlan(s.uid, id);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  if (!allowed.includes(plan.status)) redirect(homeFor(plan));
  return plan;
}

/** True while an opening deposit is on its way to Strike. */
export async function hasDepositInFlight(planId: string): Promise<boolean> {
  const [row] = await db()`select 1 from deposits where plan_id = ${planId} and purpose = 'open' and status = 'submitted' limit 1`;
  return !!row;
}
