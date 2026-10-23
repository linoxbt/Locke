// Locke risk worker (spec section 8.5). Long-lived: run on Railway, not serverless.
//
// - Streams mark prices for every plan market and recomputes each plan's margin ratio
//   (throttled to once a second per plan), with Locke's alert levels and hysteresis.
// - Logs on to each user's Strike user stream; any fill or account update refreshes that
//   user's positions immediately, and liquidation events alert at once.
// - Advances plans waiting on Strike (deposit credit, fill, buffer margin, top-ups, close)
//   so a plan finishes opening even if the user closes the tab.
// - Writes a snapshot per live plan every 60 seconds for the charts, kept for 90 days.
// - /healthz answers 503 when a watched market's prices stop, the database is unreachable, or no
//   user's Strike keys can be loaded; after two minutes unhealthy the process exits so the
//   platform restarts it (Railway restarts on exit, not on a failing health check).
// - Runs as the only active worker: a Postgres advisory lock keeps an overlapping deploy on standby.

import http from "node:http";
import WebSocket from "ws";
import {
  combinedLevel,
  distanceToLiquidation,
  LEVEL_RANK,
  liquidationPrice,
  maintenanceMargin,
  marginRatio,
  unrealisedPnl,
} from "../src/lib/domain/risk";
import { liveHeadline } from "../src/lib/domain/plans";
import type { RiskLevel } from "../src/lib/domain/types";
import { config } from "../src/lib/server/config";
import { db } from "../src/lib/server/db";
import { strikeKeysFor } from "../src/lib/server/keys";
import { addEvent, syncPlan, thresholds, type PlanRow } from "../src/lib/server/planService";
import { getMarketRules, getPositions, serverNow, type ApiKeys, type StrikePosition } from "../src/lib/strike/client";
import { signLogon } from "../src/lib/strike/sign";
import { liquidationReason } from "../src/lib/strike/stream";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

const POSITIONS_REFRESH_MS = 15_000;
const SYNC_EVERY_MS = 15_000;
const SNAPSHOT_EVERY_MS = 60_000;
const RELOAD_PLANS_MS = 10_000;
/** Positions older than this aren't trusted for a risk level (Strike unreachable, key revoked). */
const POSITIONS_STALE_MS = 60_000;
/** No mark for this long means the price stream is dead: reconnect, and report unhealthy. */
const MARKS_STALE_MS = 30_000;
/** While a plan sits at Strike's margin call or worse, the alert repeats this often. */
const REPEAT_ALERT_MS = 15 * 60_000;
const SYNC_CONCURRENCY = 4;
const SNAPSHOT_RETENTION_DAYS = 90;
const LOGON_TIMEOUT_MS = 15_000;
/** Sockets: give up on a handshake after this, ping on this cadence, and drop a socket silent this long. */
const HANDSHAKE_TIMEOUT_MS = 10_000;
const PING_EVERY_MS = 30_000;
const SILENT_SOCKET_MS = 45_000;
/** Unhealthy this long: exit so the platform restarts the worker. */
const EXIT_AFTER_UNHEALTHY_MS = 2 * 60_000;
/** A plan whose positions can't be read this long gets an event telling the user it isn't being watched. */
const DEGRADED_NOTICE_MS = 2 * 60_000;
const WORKER_LOCK = 774_211_031; // pg advisory lock key: one active worker

const marks = new Map<string, number>();
const markAt = new Map<string, number>();
const plans = new Map<string, PlanRow>();
const lastEval = new Map<string, number>();
const lastSnapshot = new Map<string, number>();
const lastSync = new Map<string, number>();
const lastRatioWrite = new Map<string, number>();
const lastAlert = new Map<string, number>();
const evaluating = new Set<string>();
/** Plan id → when its positions became unreadable. */
const degraded = new Map<string, number>();
/** Plans already told they aren't being watched (cleared when watching resumes). */
const notified = new Set<string>();
/** Users whose Strike keys couldn't be loaded or were refused, with the reason. */
const unwatchable = new Map<string, string>();

interface UserState {
  keys: ApiKeys;
  /** strike_links.updated_at when the keys were loaded: a new sign-in rotates the API wallet. */
  linkVersion: string;
  positions: StrikePosition[];
  fetchedAt: number;
  /** Last successful positions read. */
  okAt: number;
  stale: boolean;
  /** Consecutive REST failures; drives backoff so a revoked key doesn't hammer Strike. */
  failures: number;
  refreshing: boolean;
  stream?: UserStream;
}
const users = new Map<string, UserState>();

let stopping = false;
let dbOk = true;

// ── Price stream ──

class PriceStream {
  private ws?: WebSocket;
  private attempts = 0;
  private symbols = new Set<string>();

  watch(symbol: string) {
    if (this.symbols.has(symbol)) return;
    this.symbols.add(symbol);
    this.subscribe(symbol);
  }

  private subscribe(symbol: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ id: Date.now() % 1e9, method: "subscribe", channel: "markPrice@1s", symbol }));
    }
  }

  connect() {
    const ws = new WebSocket(config.strikePriceWsUrl, { handshakeTimeout: HANDSHAKE_TIMEOUT_MS });
    this.ws = ws;
    keepAlive(ws, "price");
    ws.on("open", () => {
      this.attempts = 0;
      log("[price] connected");
      for (const s of this.symbols) this.subscribe(s);
    });
    ws.on("message", (raw) => {
      for (const line of String(raw).split("\n")) {
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line);
          for (const ev of Array.isArray(m) ? m : [m]) {
            if (ev?.e === "markPriceUpdate") {
              marks.set(ev.s, parseFloat(ev.p));
              markAt.set(ev.s, Date.now());
              onMark(ev.s);
            }
          }
        } catch {
          /* ignore malformed frame */
        }
      }
    });
    ws.on("close", () => this.retry());
    ws.on("error", (e) => log("[price] error", e.message));
  }

  /** A half-open socket never closes on its own: drop it and reconnect. */
  restart() {
    log("[price] no marks for a while, reconnecting");
    this.ws?.terminate();
  }

  private retry() {
    if (stopping) return;
    const delay = Math.min(1000 * 2 ** Math.min(++this.attempts, 5), 30_000);
    setTimeout(() => this.connect(), delay);
  }

  close() {
    this.ws?.close();
  }
}

/**
 * Detect half-open sockets: ping on a schedule (Strike also answers an app-level ping) and
 * terminate a socket that has sent nothing for SILENT_SOCKET_MS, so its close handler reconnects.
 */
function keepAlive(ws: WebSocket, name: string) {
  let lastFrame = Date.now();
  const seen = () => (lastFrame = Date.now());
  ws.on("message", seen);
  ws.on("pong", seen);
  ws.on("open", seen);
  const t = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastFrame > SILENT_SOCKET_MS) {
      log(`[${name}] socket silent, reconnecting`);
      ws.terminate();
      return;
    }
    ws.ping();
    ws.send(JSON.stringify({ id: "hb", method: "ping" }));
  }, PING_EVERY_MS);
  ws.on("close", () => clearInterval(t));
}

// ── User streams ──

class UserStream {
  private ws?: WebSocket;
  private attempts = 0;
  private closed = false;
  private logonTimer?: NodeJS.Timeout;

  constructor(
    private userId: string,
    private keys: ApiKeys
  ) {}

  connect() {
    if (this.closed) return;
    const ws = new WebSocket(config.strikeUserWsUrl, { handshakeTimeout: HANDSHAKE_TIMEOUT_MS });
    this.ws = ws;
    keepAlive(ws, `user ${this.userId.slice(0, 8)}`);
    ws.on("open", async () => {
      // Signed on Strike's clock, like REST calls; a reply must come or the socket is recycled.
      const now = await serverNow().catch(() => Date.now());
      ws.send(JSON.stringify({ id: 1, method: "session.logon", params: signLogon(this.keys, now) }));
      this.logonTimer = setTimeout(() => {
        log(`[user ${this.userId.slice(0, 8)}] no logon reply, reconnecting`);
        ws.terminate();
      }, LOGON_TIMEOUT_MS);
    });
    ws.on("message", (raw) => {
      for (const line of String(raw).split("\n")) {
        if (!line.trim()) continue;
        let m: any;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.e === "error") {
          clearTimeout(this.logonTimer);
          log(`[user ${this.userId.slice(0, 8)}] error`, m.error?.code, m.error?.msg);
          if (m.error?.code === 401) {
            // Bad or revoked API wallet: back off for a while instead of hammering, and tell the user.
            this.attempts = 5;
            ws.close();
            refused(this.userId, "Strike refused Locke's connection to your account");
          }
          continue;
        }
        if (m.id === 1) {
          clearTimeout(this.logonTimer);
          if (m.status === 200) {
            this.attempts = 0;
            ws.send(JSON.stringify({ id: 2, method: "subscribe", channel: "userstream" }));
          } else {
            log(`[user ${this.userId.slice(0, 8)}] logon refused`, m.status);
            ws.close();
          }
          continue;
        }
        if (m.id === 2) {
          markStale(this.userId); // no replay on subscribe: reload REST state
          continue;
        }
        if (m.e === "ACCOUNT_UPDATE" || m.e === "ORDER_TRADE_UPDATE") this.onEvent(m.e, m.data, m.s);
      }
    });
    ws.on("close", () => {
      clearTimeout(this.logonTimer);
      if (this.closed || stopping) return;
      const delay = Math.min(1000 * 2 ** Math.min(++this.attempts, 6), 60_000);
      setTimeout(() => this.connect(), delay);
    });
    ws.on("error", (e) => log(`[user ${this.userId.slice(0, 8)}] ws error`, e.message));
  }

  private onEvent(kind: string, data: any, envelopeSymbol?: string) {
    markStale(this.userId);
    const reason = liquidationReason(kind, data);
    if (!reason) return;
    const symbols = new Set<string>([...(data?.P ?? []).map((p: any) => p.s), data?.s, envelopeSymbol].filter(Boolean));
    for (const plan of plans.values()) {
      if (plan.user_id === this.userId && symbols.has(plan.symbol)) {
        const msg = `Strike reported ${reason.toLowerCase().replace(/_/g, " ")} on this plan.`;
        setLevel(plan, "liquidation", null, msg).catch((e) => log(`[plan ${plan.id.slice(0, 8)}] level write failed`, e.message));
        lastSync.delete(plan.id);
      }
    }
  }

  close() {
    this.closed = true;
    clearTimeout(this.logonTimer);
    this.ws?.close();
  }
}

function markStale(userId: string) {
  const u = users.get(userId);
  if (u) u.stale = true;
}

// ── Risk evaluation ──

const LEVEL_MESSAGES: Record<RiskLevel, (r: string) => string> = {
  ok: (r) => `Margin health back to normal (${r}).`,
  watch: (r) => `Margin health is weakening (${r}). No action needed yet.`,
  action: (r) => `Action needed: this plan is close to liquidation (margin ratio ${r}). Top up to keep it safe.`,
  margin_call: (r) => `Strike's margin call level reached (${r}). Top up now.`,
  reduce_only: (r) => `Strike now blocks risk-increasing orders on this plan (${r}). Top up or reduce.`,
  liquidation: (r) => `Liquidation level reached on Strike (${r}).`,
};

/**
 * Record a risk level and alert on a change (or a due repeat). The in-memory level changes only
 * after both writes succeed, so a failed write is retried on the next tick instead of losing the
 * alert. Risk writes leave updated_at alone: lifecycle timers don't depend on them.
 */
async function setLevel(plan: PlanRow, level: RiskLevel, ratio: number | null, message?: string) {
  const prev = plan.risk_level;
  const now = Date.now();
  // A change always alerts; at Strike's margin call or worse the alert also repeats until it's handled.
  const repeat = prev === level && LEVEL_RANK[level] >= LEVEL_RANK.margin_call && now - (lastAlert.get(plan.id) ?? 0) >= REPEAT_ALERT_MS;
  if (prev !== level || repeat) {
    const pct = ratio != null ? `${(ratio * 100).toFixed(1)}%` : "n/a";
    const text = `${config.demoAlerts ? "[Demo levels] " : ""}${repeat ? "Still at risk: " : ""}${message ?? LEVEL_MESSAGES[level](pct)}`;
    await db().begin(async (tx) => {
      await tx`update plans set risk_level = ${level}, last_ratio = ${ratio} where id = ${plan.id}`;
      await tx`insert into plan_events (plan_id, level, message, detail)
               values (${plan.id}, ${level}, ${text}, ${tx.json({ from: prev, to: level, ratio, demo: config.demoAlerts } as never)})`;
    });
    lastAlert.set(plan.id, now);
    log(`[plan ${plan.id.slice(0, 8)}] ${prev} → ${level} ${pct}${repeat ? " (repeat)" : ""}`);
  } else {
    await db()`update plans set risk_level = ${level}, last_ratio = ${ratio} where id = ${plan.id}`;
  }
  plan.risk_level = level;
  if (ratio != null) plan.last_ratio = ratio;
}

/** Tell each of a user's plans, once, that Locke can't watch it, and why. */
async function notifyUnwatched(userId: string, reason: string) {
  for (const plan of plans.values()) {
    if (plan.user_id !== userId || notified.has(plan.id)) continue;
    if (plan.status !== "active" && plan.status !== "closing") continue;
    notified.add(plan.id);
    await addEvent(plan.id, "action", `Locke can't watch this plan right now: ${reason}. Sign in again to reconnect; until then nobody is alerted if margin runs low.`).catch(
      (e) => {
        notified.delete(plan.id);
        log(`[plan ${plan.id.slice(0, 8)}] notice failed`, e.message);
      }
    );
  }
}

function refused(userId: string, reason: string) {
  unwatchable.set(userId, reason);
  void notifyUnwatched(userId, reason);
}

function onMark(symbol: string) {
  for (const plan of plans.values()) if (plan.symbol === symbol) onPlanTick(plan);
}

/** Evaluate a live plan, at most once a second and never two evaluations of it at once. */
function onPlanTick(plan: PlanRow) {
  if (plan.status !== "active" && plan.status !== "closing") return;
  const now = Date.now();
  if (now - (lastEval.get(plan.id) ?? 0) < 1000 || evaluating.has(plan.id)) return;
  lastEval.set(plan.id, now);
  evaluating.add(plan.id);
  evaluate(plan)
    .catch((e) => log(`[plan ${plan.id.slice(0, 8)}] evaluate failed`, e.message))
    .finally(() => evaluating.delete(plan.id));
}

async function evaluate(plan: PlanRow) {
  const u = users.get(plan.user_id);
  const mark = marks.get(plan.symbol);
  if (!u || mark == null) return;
  // Never compute a level from stale positions: a revoked key or a Strike outage would freeze it.
  if (Date.now() - u.okAt > POSITIONS_STALE_MS) {
    const since = degraded.get(plan.id);
    if (since == null) {
      degraded.set(plan.id, Date.now());
      log(`[plan ${plan.id.slice(0, 8)}] monitoring degraded: positions are stale`);
    } else if (Date.now() - since > DEGRADED_NOTICE_MS) {
      void notifyUnwatched(plan.user_id, "Strike hasn't answered for this account for a few minutes");
    }
    return;
  }
  if (degraded.delete(plan.id)) notified.delete(plan.id);
  const pos = u.positions.find((p) => p.symbol === plan.symbol);
  if (!pos) return; // syncPlan decides whether the plan closed
  const rules = await getMarketRules(plan.symbol);
  const signed = parseFloat(pos.size);
  const entry = parseFloat(pos.entry_price);
  const iso = parseFloat(pos.iso_balance);
  const upnl = unrealisedPnl(signed, entry, mark);
  const mm = maintenanceMargin(rules.tiers, signed, mark);
  let ratio = marginRatio(mm, iso, upnl);
  if (!isFinite(ratio)) ratio = 1;
  const liq = parseFloat(pos.liquidation_price) || liquidationPrice(rules.tiers, signed, entry, iso);
  const level = combinedLevel(ratio, distanceToLiquidation(signed, mark, liq), plan.risk_level, thresholds());

  // Persist a level change (or a due repeat) at once; otherwise refresh last_ratio at most every 10 s.
  const now = Date.now();
  if (level !== plan.risk_level || LEVEL_RANK[level] >= LEVEL_RANK.margin_call) {
    await setLevel(plan, level, ratio);
    lastRatioWrite.set(plan.id, now);
  } else if (now - (lastRatioWrite.get(plan.id) ?? 0) >= 10_000) {
    lastRatioWrite.set(plan.id, now);
    plan.last_ratio = ratio;
    await db()`update plans set last_ratio = ${ratio} where id = ${plan.id}`;
  }

  if (now - (lastSnapshot.get(plan.id) ?? 0) >= SNAPSHOT_EVERY_MS) {
    lastSnapshot.set(plan.id, now);
    const funding = parseFloat(pos.accumulated_funding_fees) || 0;
    const headline = liveHeadline(plan.type, plan.inputs, Math.abs(signed), entry, mark, funding);
    await db()`insert into snapshots (plan_id, mark, ratio, upnl, iso_balance, funding, headline)
               values (${plan.id}, ${mark}, ${ratio}, ${upnl}, ${iso}, ${funding}, ${headline})`;
  }
}

// ── Loops ──

function forgetPlan(id: string) {
  plans.delete(id);
  for (const m of [lastEval, lastSnapshot, lastSync, lastRatioWrite, lastAlert, degraded]) m.delete(id);
  notified.delete(id);
}

async function startUser(uid: string, linkVersion: string) {
  const keys = await strikeKeysFor(uid);
  unwatchable.delete(uid);
  const state: UserState = { keys, linkVersion, positions: [], fetchedAt: 0, okAt: 0, stale: true, failures: 0, refreshing: false };
  state.stream = new UserStream(uid, keys);
  state.stream.connect();
  users.set(uid, state);
}

async function reloadPlans() {
  const rows = (await db()`
    select * from plans where status in ('funding','opening','active','closing')`) as unknown as PlanRow[];
  const live = new Set(rows.map((r) => r.id));
  for (const id of [...plans.keys()]) if (!live.has(id)) forgetPlan(id);
  for (const r of rows) {
    const existing = plans.get(r.id);
    // Keep the in-memory level (hysteresis) unless the row moved on.
    plans.set(r.id, existing && existing.status === r.status ? { ...r, risk_level: existing.risk_level } : r);
    priceStream.watch(r.symbol);
  }

  const wanted = [...new Set(rows.map((r) => r.user_id))];
  for (const [uid, u] of users) {
    if (!wanted.includes(uid)) {
      u.stream?.close();
      users.delete(uid);
    }
  }
  for (const uid of [...unwatchable.keys()]) if (!wanted.includes(uid)) unwatchable.delete(uid);
  if (wanted.length === 0) return;
  const links = await db()`select user_id, updated_at from strike_links where user_id in ${db()(wanted)}`;
  const versions = new Map(links.map((l) => [l.user_id as string, new Date(l.updated_at).toISOString()]));
  for (const uid of wanted) {
    const version = versions.get(uid) ?? "none";
    const existing = users.get(uid);
    if (existing && existing.linkVersion === version) continue;
    if (!existing && unwatchable.has(uid) && unwatchable.get(uid)!.endsWith(version)) continue; // same keys failed already
    // New user, or the user signed in again and Strike issued a new API wallet: reload the keys.
    if (existing) {
      log(`[user ${uid.slice(0, 8)}] Strike connection changed, reloading keys`);
      existing.stream?.close();
      users.delete(uid);
    }
    try {
      await startUser(uid, version);
      notified.forEach((id) => plans.get(id)?.user_id === uid && notified.delete(id));
    } catch (e: any) {
      log(`[user ${uid.slice(0, 8)}] no usable Strike keys:`, e.message);
      // Remember which key version failed so it isn't retried every reload; a new sign-in changes it.
      unwatchable.set(uid, `its Strike connection can't be used (${e?.status === 401 ? "expired" : "unreadable"}) @${version}`);
      void notifyUnwatched(uid, "Locke can't use your Strike connection");
    }
  }
}

/** Refresh each user's positions on its own schedule: one slow or failing user never delays the others. */
async function refreshPositions() {
  const now = Date.now();
  for (const [uid, u] of users) {
    if (u.refreshing) continue;
    const backoff = u.failures ? Math.min(POSITIONS_REFRESH_MS * 2 ** (u.failures - 1), 5 * 60_000) : 0;
    if (u.failures && now - u.fetchedAt < backoff) continue;
    if (!u.failures && !u.stale && now - u.fetchedAt < POSITIONS_REFRESH_MS) continue;
    u.fetchedAt = now;
    u.refreshing = true;
    getPositions(u.keys)
      .then((positions) => {
        u.positions = positions;
        u.stale = false;
        u.failures = 0;
        u.okAt = Date.now();
        // Re-check this user's plans on the new numbers (funding or a fill moves them without a tick).
        for (const plan of plans.values()) if (plan.user_id === uid) onPlanTick(plan);
      })
      .catch((e: any) => {
        u.failures++;
        if (e?.status === 401) refused(uid, "Strike refused Locke's connection to your account");
        log(`[user ${uid.slice(0, 8)}] positions failed (${u.failures}x, backing off):`, e.message);
      })
      .finally(() => (u.refreshing = false));
  }
}

/** Run tasks with at most `limit` in flight, so one slow plan can't hold up the rest. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
    })
  );
}

async function syncWaitingPlans() {
  const now = Date.now();
  const pendingTopups = new Set(
    (await db()`select distinct plan_id from deposits where status in ('built','submitted','credited') and plan_id is not null`).map(
      (r) => r.plan_id as string
    )
  );
  const due = [...plans.values()].filter((plan) => {
    const waiting = plan.status !== "active" || pendingTopups.has(plan.id) || !plan.buffer_added || !!plan.pending_order;
    return now - (lastSync.get(plan.id) ?? 0) >= (waiting ? SYNC_EVERY_MS : 5 * SYNC_EVERY_MS);
  });
  await pool(due, SYNC_CONCURRENCY, async (plan) => {
    lastSync.set(plan.id, Date.now());
    try {
      const next = await syncPlan(plan.user_id, plan.id);
      if (next.status !== plan.status || next.pending_order !== plan.pending_order || next.buffer_added !== plan.buffer_added) {
        markStale(plan.user_id);
        plans.set(plan.id, { ...next, risk_level: plan.status === next.status ? plan.risk_level : next.risk_level });
      }
    } catch (e: any) {
      log(`[plan ${plan.id.slice(0, 8)}] sync failed:`, e.message);
    }
  });
}

/** Markets with a live plan whose marks have stopped (each market on its own: one can freeze while another flows). */
function staleMarkets(now = Date.now()): string[] {
  const watched = new Set([...plans.values()].filter((p) => p.status === "active" || p.status === "closing").map((p) => p.symbol));
  return [...watched].filter((s) => now - (markAt.get(s) ?? startedAt) > MARKS_STALE_MS);
}

let unhealthySince: number | null = null;

/** Restart a silent price stream, check the database and the worker lock, and exit if unhealthy for too long. */
async function watchdog() {
  const now = Date.now();
  if (staleMarkets(now).length) priceStream.restart();
  try {
    await db()`select 1`;
    dbOk = true;
  } catch (e: any) {
    dbOk = false;
    log("[db] unreachable:", e.message);
  }
  if (lockConn) {
    try {
      await lockConn`select 1`;
    } catch {
      log("[lock] lost the worker lock's connection; exiting so a fresh worker takes over");
      process.exit(1);
    }
  }
  const h = health();
  unhealthySince = h.ok ? null : (unhealthySince ?? now);
  if (unhealthySince && now - unhealthySince > EXIT_AFTER_UNHEALTHY_MS) {
    log("[health] unhealthy for over two minutes; exiting so the platform restarts the worker", JSON.stringify(h));
    process.exit(1);
  }
}

async function pruneSnapshots() {
  const r = await db()`delete from snapshots where created_at < now() - make_interval(days => ${SNAPSHOT_RETENTION_DAYS})`;
  if (r.count) log(`[snapshots] pruned ${r.count} older than ${SNAPSHOT_RETENTION_DAYS} days`);
}

function every(ms: number, fn: () => Promise<void>, name: string) {
  let running = false;
  const t = setInterval(async () => {
    if (running || stopping) return;
    running = true;
    try {
      await fn();
    } catch (e: any) {
      log(`[${name}]`, e.message);
    } finally {
      running = false;
    }
  }, ms);
  return t;
}

const priceStream = new PriceStream();
const startedAt = Date.now();

function health() {
  const now = Date.now();
  const lastMark = Math.max(0, ...markAt.values());
  const marksAgeMs = lastMark ? now - lastMark : null;
  // Give the stream a minute to connect after a start before calling it unhealthy.
  const warmingUp = now - startedAt < 60_000;
  const stale = warmingUp ? [] : staleMarkets(now);
  const marksOk = marksAgeMs != null ? stale.length === 0 && marksAgeMs <= MARKS_STALE_MS : warmingUp;
  // Users with live plans but no usable keys: if that's everyone, something is wrong with this worker
  // (e.g. LOCKE_KEY_ENC differs from the app's), not with the users.
  const wanted = new Set([...plans.values()].map((p) => p.user_id));
  const keysOk = wanted.size === 0 || users.size > 0;
  // On standby (another worker holds the lock) this one is healthy by definition: a deploy's new
  // container must pass its health check before the platform stops the old one.
  if (!lockHeld) return { ok: true, standby: true };
  return {
    ok: marksOk && dbOk && keysOk,
    standby: false,
    marksAgeMs,
    staleMarkets: stale,
    db: dbOk,
    plans: plans.size,
    users: users.size,
    unwatchableUsers: unwatchable.size,
    degraded: degraded.size,
    demoAlerts: config.demoAlerts,
    marks: Object.fromEntries(marks),
  };
}

// ── One active worker ──

let lockConn: Awaited<ReturnType<ReturnType<typeof db>["reserve"]>> | null = null;
let lockHeld = false;

/**
 * Hold a session-level advisory lock on a dedicated connection; a second worker (an overlapping
 * deploy, a replica) waits on standby until the first exits. Session locks need a session: the
 * transaction pooler (port 6543) can't hold one, so there the lock is skipped with a warning.
 */
async function acquireWorkerLock() {
  if (/:6543\b/.test(config.databaseUrl)) {
    log("[lock] DATABASE_URL is a transaction pooler; can't hold the worker lock. Use the session pooler or a direct connection.");
    lockHeld = true;
    return;
  }
  lockConn = await db().reserve();
  for (;;) {
    const [r] = await lockConn`select pg_try_advisory_lock(${WORKER_LOCK}) as ok`;
    if (r.ok) break;
    log("[lock] another worker is active; standing by");
    await new Promise((res) => setTimeout(res, 10_000));
    if (stopping) return;
  }
  lockHeld = true;
  log("[lock] this worker is active");
}

async function main() {
  // Fail fast: a worker without these would run, look healthy, and place fee-less orders or none.
  void config.databaseUrl;
  void config.keyEnc;
  void config.builderFeeBps;
  log(`Locke risk worker starting${config.demoAlerts ? " (DEMO alert levels)" : ""}`);
  const port = Number(process.env.PORT ?? 8080);
  const server = http
    .createServer((req, res) => {
      if (req.url === "/healthz") {
        const h = health();
        res.writeHead(h.ok ? 200 : 503, { "Content-Type": "application/json" });
        res.end(JSON.stringify(h));
        return;
      }
      res.writeHead(404).end();
    })
    .listen(port, () => log(`health on :${port}/healthz`));

  await acquireWorkerLock();
  priceStream.watch("ADA-USD");
  priceStream.watch("WTI-USD");
  priceStream.connect();
  await reloadPlans();
  await refreshPositions();

  const timers = [
    every(RELOAD_PLANS_MS, reloadPlans, "reload"),
    every(1_000, refreshPositions, "positions"),
    every(5_000, syncWaitingPlans, "sync"),
    every(10_000, watchdog, "watchdog"),
    every(24 * 3600_000, pruneSnapshots, "retention"),
  ];
  void pruneSnapshots().catch((e) => log("[retention]", e.message));

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log("shutting down");
    timers.forEach(clearInterval);
    priceStream.close();
    for (const u of users.values()) u.stream?.close();
    server.close();
    lockConn?.release();
    await db().end({ timeout: 5 });
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// A stray rejection must never take the worker down silently: log it and keep watching.
process.on("unhandledRejection", (e) => log("[unhandled]", e instanceof Error ? e.message : e));

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
