// Risk monitoring shared by the long-running worker (worker/index.ts, live streams, every second)
// and the scheduled sweep (netlify/functions/monitor.mts, REST, every minute). Both assess a plan
// the same way and write alerts the same way; only how often they look differs.

import { liveHeadline } from "../domain/plans";
import {
  combinedLevel,
  distanceToLiquidation,
  LEVEL_RANK,
  liquidationPrice,
  maintenanceMargin,
  marginRatio,
  unrealisedPnl,
} from "../domain/risk";
import type { MarketRules, RiskLevel } from "../domain/types";
import { getMarketRules, getMarkPrice, getPositions, type StrikePosition } from "../strike/client";
import { config } from "./config";
import { db } from "./db";
import { strikeKeysFor } from "./keys";
import { addEvent, syncPlan, thresholds, type PlanRow } from "./planService";

/** pg advisory lock key held by the active worker; the sweep stands down while it's held. */
export const WORKER_LOCK = 774_211_031;
/** While a plan sits at Strike's margin call or worse, the alert repeats this often. */
export const REPEAT_ALERT_MS = 15 * 60_000;

export const LEVEL_MESSAGES: Record<RiskLevel, (r: string) => string> = {
  ok: (r) => `Margin health back to normal (${r}).`,
  watch: (r) => `Margin health is weakening (${r}). No action needed yet.`,
  action: (r) => `Action needed: this plan is close to liquidation (margin ratio ${r}). Top up to keep it safe.`,
  margin_call: (r) => `Strike's margin call level reached (${r}). Top up now.`,
  reduce_only: (r) => `Strike now blocks risk-increasing orders on this plan (${r}). Top up or reduce.`,
  liquidation: (r) => `Liquidation level reached on Strike (${r}).`,
};

export interface Assessment {
  level: RiskLevel;
  ratio: number;
  upnl: number;
  iso: number;
  funding: number;
  headline: number;
}

/** A live plan's margin health from its position and the mark, with hysteresis from its last level. */
export function assessPlan(plan: PlanRow, pos: StrikePosition, mark: number, rules: MarketRules): Assessment {
  const signed = parseFloat(pos.size);
  const entry = parseFloat(pos.entry_price);
  const iso = parseFloat(pos.iso_balance);
  const upnl = unrealisedPnl(signed, entry, mark);
  const mm = maintenanceMargin(rules.tiers, signed, mark);
  let ratio = marginRatio(mm, iso, upnl);
  if (!isFinite(ratio)) ratio = 1;
  const liq = parseFloat(pos.liquidation_price) || liquidationPrice(rules.tiers, signed, entry, iso);
  const level = combinedLevel(ratio, distanceToLiquidation(signed, mark, liq), plan.risk_level, thresholds());
  const funding = parseFloat(pos.accumulated_funding_fees) || 0;
  return { level, ratio, upnl, iso, funding, headline: liveHeadline(plan.type, plan.inputs, Math.abs(signed), entry, mark, funding) };
}

/**
 * Write a level change (or a repeat) and its alert in one transaction. Risk writes leave
 * updated_at alone: lifecycle timers don't depend on them.
 */
export async function recordLevel(
  planId: string,
  prev: RiskLevel,
  level: RiskLevel,
  ratio: number | null,
  opts: { repeat?: boolean; message?: string } = {}
) {
  const pct = ratio != null ? `${(ratio * 100).toFixed(1)}%` : "n/a";
  const text = `${config.demoAlerts ? "[Demo levels] " : ""}${opts.repeat ? "Still at risk: " : ""}${opts.message ?? LEVEL_MESSAGES[level](pct)}`;
  await db().begin(async (tx) => {
    await tx`update plans set risk_level = ${level}, last_ratio = ${ratio} where id = ${planId}`;
    await tx`insert into plan_events (plan_id, level, message, detail)
             values (${planId}, ${level}, ${text}, ${tx.json({ from: prev, to: level, ratio, demo: config.demoAlerts } as never)})`;
  });
}

const UNWATCHED = "Locke can't watch this plan right now";

/** Tell a plan once (per 6 hours) that it isn't being watched, and why. */
async function noteUnwatched(planId: string, reason: string) {
  const [recent] = await db()`select 1 from plan_events where plan_id = ${planId} and message like ${UNWATCHED + "%"}
                              and created_at > now() - interval '6 hours' limit 1`;
  if (recent) return;
  await addEvent(planId, "action", `${UNWATCHED}: ${reason}. Sign in again to reconnect; until then nobody is alerted if margin runs low.`);
}

export interface SweepResult {
  skipped?: string;
  plans: number;
  synced: number;
  assessed: number;
  alerts: number;
  unwatched: number;
  errors: number;
  ms: number;
}

/**
 * One pass over every waiting or live plan: advance the lifecycle (deposits, fills, buffer,
 * top-ups, closes), then assess each live plan, alert on a level change (and repeat at margin call
 * or worse), and record a snapshot. Stops before `budgetMs` so a scheduled run never times out;
 * whatever it didn't reach, the next run does first (least recently updated first).
 */
export async function sweep(budgetMs = 24_000): Promise<SweepResult> {
  const started = Date.now();
  const out: SweepResult = { plans: 0, synced: 0, assessed: 0, alerts: 0, unwatched: 0, errors: 0, ms: 0 };
  const sql = db();
  const [{ held }] = await sql`select exists(select 1 from pg_locks where locktype = 'advisory' and objid = ${WORKER_LOCK} and granted) as held`;
  if (held) return { ...out, skipped: "the risk worker is active", ms: Date.now() - started };

  const rows = (await sql`select * from plans where status in ('funding','opening','active','closing')
                          order by updated_at limit 200`) as unknown as PlanRow[];
  out.plans = rows.length;
  const byUser = new Map<string, PlanRow[]>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  const timeLeft = () => budgetMs - (Date.now() - started);

  for (const [uid, userPlans] of byUser) {
    if (timeLeft() < 4_000) break;
    let keys;
    try {
      keys = await strikeKeysFor(uid);
    } catch (e) {
      for (const p of userPlans) if (p.status === "active" || p.status === "closing") await noteUnwatched(p.id, "Locke can't use your Strike connection").catch(() => out.errors++);
      out.unwatched += userPlans.length;
      console.error("[monitor] keys", uid.slice(0, 8), e instanceof Error ? e.message : e);
      continue;
    }

    // Lifecycle first: a plan may finish opening or closing in this pass.
    const current: PlanRow[] = [];
    for (const p of userPlans) {
      if (timeLeft() < 3_000) break;
      try {
        current.push(await syncPlan(uid, p.id));
        out.synced++;
      } catch (e) {
        out.errors++;
        current.push(p);
        console.error("[monitor] sync", p.id.slice(0, 8), e instanceof Error ? e.message : e);
      }
    }

    const live = current.filter((p) => p.status === "active" || p.status === "closing");
    if (live.length === 0 || timeLeft() < 2_000) continue;
    let positions: StrikePosition[];
    try {
      positions = await getPositions(keys);
    } catch (e) {
      out.errors++;
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403) for (const p of live) await noteUnwatched(p.id, "Strike refused Locke's connection to your account").catch(() => out.errors++);
      console.error("[monitor] positions", uid.slice(0, 8), e instanceof Error ? e.message : e);
      continue;
    }

    for (const plan of live) {
      const pos = positions.find((x) => x.symbol === plan.symbol);
      if (!pos) continue; // syncPlan decides whether the plan closed
      try {
        const [mark, rules] = await Promise.all([getMarkPrice(plan.symbol), getMarketRules(plan.symbol)]);
        const a = assessPlan(plan, pos, mark.mark, rules);
        out.assessed++;
        let repeat = false;
        if (a.level === plan.risk_level && LEVEL_RANK[a.level] >= LEVEL_RANK.margin_call) {
          const [last] = await sql`select created_at from plan_events where plan_id = ${plan.id} and level = ${a.level}
                                   order by id desc limit 1`;
          repeat = !last || Date.now() - new Date(last.created_at).getTime() >= REPEAT_ALERT_MS;
        }
        if (a.level !== plan.risk_level || repeat) {
          await recordLevel(plan.id, plan.risk_level, a.level, a.ratio, { repeat });
          out.alerts++;
        } else {
          await sql`update plans set last_ratio = ${a.ratio} where id = ${plan.id}`;
        }
        await sql`insert into snapshots (plan_id, mark, ratio, upnl, iso_balance, funding, headline)
                  values (${plan.id}, ${mark.mark}, ${a.ratio}, ${a.upnl}, ${a.iso}, ${a.funding}, ${a.headline})`;
      } catch (e) {
        out.errors++;
        console.error("[monitor] assess", plan.id.slice(0, 8), e instanceof Error ? e.message : e);
      }
    }
  }
  out.ms = Date.now() - started;
  await sql`insert into monitor_heartbeat (id, at, result) values (1, now(), ${sql.json(out as never)})
            on conflict (id) do update set at = excluded.at, result = excluded.result`.catch(() => null);
  return out;
}
