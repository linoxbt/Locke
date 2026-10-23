// Read models shared by API routes and server-rendered pages, so a page's first paint and
// the JSON it later polls are always the same shape.

import type { Preview } from "../domain/types";
import { getPosition, getPositions, type StrikePosition } from "../strike/client";
import { db } from "./db";
import { HttpError } from "./errors";
import { strikeKeysFor } from "./keys";
import { loadPlan, planView, previewFor, type PlanRow, type PlanView } from "./planService";

export interface PlanEventRow {
  id: number;
  level: string;
  message: string;
  created_at: string;
}

export interface SnapshotRow {
  mark: number;
  ratio: number | null;
  headline: number | null;
  created_at: string;
}

export interface DepositRow {
  id: string;
  purpose: "open" | "topup";
  status: string;
  lovelace: number;
  usd_value: number;
  tx_hash: string | null;
  created_at: string;
}

export interface PlanDetail {
  plan: PlanView;
  preview: Preview | null;
  /** Set when the preview couldn't be priced (Strike unreachable); `preview` is then null. */
  previewError: string | null;
  events: PlanEventRow[];
  snapshots: SnapshotRow[];
  deposits: DepositRow[];
  /** Set when Strike couldn't be reached; the page renders stored data and says so. */
  liveError: string | null;
}

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d));

/** What to tell the user when Strike couldn't be read: our own messages pass, raw library errors don't. */
function liveErrorText(e: unknown): string {
  return e instanceof HttpError ? e.message : "Strike can't be reached right now. Numbers will update when it's back.";
}

/** `withPreview: false` skips re-pricing the preview (order book, fees) for polls that already have one. */
export async function getPlanDetail(userId: string, planId: string, { withPreview = true } = {}): Promise<PlanDetail> {
  const plan = await loadPlan(userId, planId);
  const live = plan.status === "active" || plan.status === "closing";
  // null = no position; undefined = Strike couldn't be read (the view then says the numbers aren't live).
  let pos: StrikePosition | null | undefined = null;
  let liveError: string | null = null;
  if (live) {
    try {
      pos = await getPosition(await strikeKeysFor(userId), plan.symbol);
    } catch (e) {
      pos = undefined;
      liveError = liveErrorText(e);
    }
  }
  const sql = db();
  let previewError: string | null = null;
  const pricePreview =
    withPreview && (plan.status === "draft" || plan.status === "funding")
      ? previewFor(plan).catch((e) => {
          previewError = e instanceof HttpError ? e.message : "Can't price this plan right now. Retrying.";
          return null;
        })
      : Promise.resolve(null);
  const [view, events, snapshots, deposits, preview] = await Promise.all([
    planView(plan, pos),
    sql`select id, level, message, created_at from plan_events where plan_id = ${plan.id} order by id desc limit 100`,
    // The newest snapshots (one a minute): select the latest, then put them back in time order.
    sql`select * from (select mark, ratio, headline, created_at from snapshots where plan_id = ${plan.id}
        and created_at > now() - interval '7 days' order by created_at desc limit 2000) recent order by created_at asc`,
    sql`select id, purpose, status, lovelace, usd_value, tx_hash, created_at from deposits
        where plan_id = ${plan.id} order by created_at desc limit 20`,
    pricePreview,
  ]);
  return {
    plan: view,
    preview,
    previewError,
    events: events.map((e) => ({ id: Number(e.id), level: e.level, message: e.message, created_at: iso(e.created_at) })),
    snapshots: snapshots.map((s) => ({ mark: Number(s.mark), ratio: s.ratio, headline: s.headline, created_at: iso(s.created_at) })),
    deposits: deposits.map((d) => ({ ...(d as unknown as DepositRow), created_at: iso(d.created_at) })),
    liveError,
  };
}

export async function listPlanViews(userId: string): Promise<{ plans: PlanView[]; liveError: string | null }> {
  const rows = (await db()`
    select * from plans where user_id = ${userId}
    order by (status = 'closed'), (status = 'draft'), created_at desc limit 50`) as unknown as PlanRow[];
  // undefined = Strike couldn't be read (the view then says the numbers aren't live); [] = read, nothing open.
  let positions: StrikePosition[] | undefined = [];
  let liveError: string | null = null;
  if (rows.some((r) => r.status === "active" || r.status === "closing")) {
    try {
      positions = await getPositions(await strikeKeysFor(userId));
    } catch (e) {
      positions = undefined;
      liveError = liveErrorText(e);
    }
  }
  const plans = await Promise.all(
    rows.map((r) => planView(r, positions ? (positions.find((p) => p.symbol === r.symbol) ?? null) : undefined))
  );
  return { plans, liveError };
}

export interface AccountInfo {
  address: string;
  stakeAddress: string | null;
  accountId: string | null;
  createdAt: string;
}

export async function getAccountInfo(userId: string): Promise<AccountInfo | null> {
  const [u] = await db()`select u.address, u.stake_address, u.created_at, l.account_id from users u
                         left join strike_links l on l.user_id = u.id where u.id = ${userId}`;
  if (!u) return null;
  return { address: u.address, stakeAddress: u.stake_address, accountId: u.account_id, createdAt: iso(u.created_at) };
}
