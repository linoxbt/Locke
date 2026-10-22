// Locke risk worker (spec section 8.5). Long-lived: run on Railway, not serverless.
//
// - Streams mark prices for every plan market and recomputes each plan's margin ratio
//   (throttled to once a second per plan), with Locke's alert levels and hysteresis.
// - Logs on to each user's Strike user stream; any fill or account update refreshes that
//   user's positions immediately, and liquidation events alert at once.
// - Advances plans waiting on Strike (deposit credit, fill, buffer margin, top-ups, close)
//   so a plan finishes opening even if the user closes the tab.
// - Writes a snapshot per active plan every 60 seconds for the charts.

import http from "node:http";
import WebSocket from "ws";
import { combinedLevel, distanceToLiquidation, liquidationPrice, maintenanceMargin, marginRatio } from "../src/lib/domain/risk";
import { liveHeadline } from "../src/lib/domain/plans";
import type { RiskLevel } from "../src/lib/domain/types";
import { config } from "../src/lib/server/config";
import { db } from "../src/lib/server/db";
import { strikeKeysFor } from "../src/lib/server/keys";
import { addEvent, syncPlan, thresholds, type PlanRow } from "../src/lib/server/planService";
import { getMarketRules, getPositions, type ApiKeys, type StrikePosition } from "../src/lib/strike/client";
import { signLogon } from "../src/lib/strike/sign";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

const POSITIONS_REFRESH_MS = 15_000;
const SYNC_EVERY_MS = 15_000;
const SNAPSHOT_EVERY_MS = 60_000;
const RELOAD_PLANS_MS = 10_000;

const marks = new Map<string, number>();
const plans = new Map<string, PlanRow>();
const lastEval = new Map<string, number>();
const lastSnapshot = new Map<string, number>();
const lastSync = new Map<string, number>();
const lastRatioWrite = new Map<string, number>();

interface UserState {
  keys: ApiKeys;
  positions: StrikePosition[];
  fetchedAt: number;
  stale: boolean;
  /** Consecutive REST failures; drives backoff so a revoked key doesn't hammer Strike. */
  failures: number;
  stream?: UserStream;
}
const users = new Map<string, UserState>();

let stopping = false;

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
    const ws = new WebSocket(config.strikePriceWsUrl);
    this.ws = ws;
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

  private retry() {
    if (stopping) return;
    const delay = Math.min(1000 * 2 ** Math.min(++this.attempts, 5), 30_000);
    setTimeout(() => this.connect(), delay);
  }

  close() {
    this.ws?.close();
  }
}

// ── User streams ──

class UserStream {
  private ws?: WebSocket;
  private attempts = 0;
  private closed = false;

  constructor(
    private userId: string,
    private keys: ApiKeys
  ) {}

  connect() {
    if (this.closed) return;
    const ws = new WebSocket(config.strikeUserWsUrl);
    this.ws = ws;
    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "session.logon", params: signLogon(this.keys, Date.now()) }));
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
          log(`[user ${this.userId.slice(0, 8)}] error`, m.error?.code, m.error?.msg);
          if (m.error?.code === 401) {
            // Bad or revoked API wallet: back off for a while instead of hammering.
            this.attempts = 5;
            ws.close();
          }
          continue;
        }
        if (m.id === 1 && m.status === 200) {
          this.attempts = 0;
          ws.send(JSON.stringify({ id: 2, method: "subscribe", channel: "userstream" }));
          continue;
        }
        if (m.id === 2) {
          markStale(this.userId); // no replay on subscribe: reload REST state
          continue;
        }
        if (m.e === "ACCOUNT_UPDATE" || m.e === "ORDER_TRADE_UPDATE") this.onEvent(m.e, m.data);
      }
    });
    ws.on("close", () => {
      if (this.closed || stopping) return;
      const delay = Math.min(1000 * 2 ** Math.min(++this.attempts, 6), 60_000);
      setTimeout(() => this.connect(), delay);
    });
    ws.on("error", (e) => log(`[user ${this.userId.slice(0, 8)}] ws error`, e.message));
  }

  private onEvent(kind: string, data: any) {
    markStale(this.userId);
    const reason = data?.e;
    const liquidated =
      (kind === "ACCOUNT_UPDATE" && (reason === "PARTIAL_LIQUIDATED" || reason === "FULLY_LIQUIDATED" || reason === "ADL")) ||
      (kind === "ORDER_TRADE_UPDATE" && typeof data?.c === "string" && /^(liq_|bankrupt_|adl_)/.test(data.c));
    if (!liquidated) return;
    const symbols = new Set<string>([...(data?.P ?? []).map((p: any) => p.s), data?.s].filter(Boolean));
    for (const plan of plans.values()) {
      if (plan.user_id === this.userId && symbols.has(plan.symbol)) {
        void setLevel(plan, "liquidation", null, `Strike reported ${String(reason ?? "a liquidation").toLowerCase().replace(/_/g, " ")} on this plan.`);
        lastSync.delete(plan.id);
      }
    }
  }

  close() {
    this.closed = true;
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

async function setLevel(plan: PlanRow, level: RiskLevel, ratio: number | null, message?: string) {
  const prev = plan.risk_level;
  plan.risk_level = level;
  if (ratio != null) plan.last_ratio = ratio;
  await db()`update plans set risk_level = ${level}, last_ratio = ${ratio}, updated_at = now() where id = ${plan.id}`;
  if (prev !== level) {
    const pct = ratio != null ? `${(ratio * 100).toFixed(1)}%` : "n/a";
    await addEvent(plan.id, level, message ?? LEVEL_MESSAGES[level](pct), { from: prev, to: level, ratio });
    log(`[plan ${plan.id.slice(0, 8)}] ${prev} → ${level} ${pct}`);
  }
}

function onMark(symbol: string) {
  const now = Date.now();
  for (const plan of plans.values()) {
    if (plan.symbol !== symbol || plan.status !== "active") continue;
    if (now - (lastEval.get(plan.id) ?? 0) < 1000) continue;
    lastEval.set(plan.id, now);
    void evaluate(plan).catch((e) => log(`[plan ${plan.id.slice(0, 8)}] evaluate failed`, e.message));
  }
}

async function evaluate(plan: PlanRow) {
  const u = users.get(plan.user_id);
  const mark = marks.get(plan.symbol);
  if (!u || mark == null) return;
  const pos = u.positions.find((p) => p.symbol === plan.symbol);
  if (!pos) return; // sync() decides whether the plan closed
  const rules = await getMarketRules(plan.symbol);
  const signed = parseFloat(pos.size);
  const entry = parseFloat(pos.entry_price);
  const iso = parseFloat(pos.iso_balance);
  const upnl = signed * (mark - entry);
  const mm = maintenanceMargin(rules.tiers, signed, mark);
  let ratio = marginRatio(mm, iso, upnl);
  if (!isFinite(ratio)) ratio = 1;
  const liq = parseFloat(pos.liquidation_price) || liquidationPrice(rules.tiers, signed, entry, iso);
  const level = combinedLevel(ratio, distanceToLiquidation(signed, mark, liq), plan.risk_level, thresholds());

  // Persist a level change at once; otherwise refresh last_ratio at most every 10 s.
  const now = Date.now();
  if (level !== plan.risk_level) {
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

async function reloadPlans() {
  const rows = (await db()`
    select * from plans where status in ('funding','opening','active','closing')`) as unknown as PlanRow[];
  const live = new Set(rows.map((r) => r.id));
  for (const id of plans.keys()) if (!live.has(id)) plans.delete(id);
  for (const r of rows) {
    const existing = plans.get(r.id);
    // Keep the in-memory level (hysteresis) unless the row moved on.
    plans.set(r.id, existing && existing.status === r.status ? { ...r, risk_level: existing.risk_level } : r);
    priceStream.watch(r.symbol);
  }

  const wanted = new Set(rows.map((r) => r.user_id));
  for (const [uid, u] of users) {
    if (!wanted.has(uid)) {
      u.stream?.close();
      users.delete(uid);
    }
  }
  for (const uid of wanted) {
    if (users.has(uid)) continue;
    try {
      const keys = await strikeKeysFor(uid);
      const state: UserState = { keys, positions: [], fetchedAt: 0, stale: true, failures: 0 };
      state.stream = new UserStream(uid, keys);
      state.stream.connect();
      users.set(uid, state);
    } catch (e: any) {
      log(`[user ${uid.slice(0, 8)}] no usable Strike keys:`, e.message);
    }
  }
}

async function refreshPositions() {
  const now = Date.now();
  await Promise.all(
    [...users.entries()].map(async ([uid, u]) => {
      const backoff = u.failures ? Math.min(POSITIONS_REFRESH_MS * 2 ** (u.failures - 1), 5 * 60_000) : 0;
      if (u.failures && now - u.fetchedAt < backoff) return;
      if (!u.failures && !u.stale && now - u.fetchedAt < POSITIONS_REFRESH_MS) return;
      u.fetchedAt = now;
      try {
        u.positions = await getPositions(u.keys);
        u.stale = false;
        u.failures = 0;
      } catch (e: any) {
        u.failures++;
        log(`[user ${uid.slice(0, 8)}] positions failed (${u.failures}x, backing off):`, e.message);
      }
    })
  );
}

async function syncWaitingPlans() {
  const now = Date.now();
  const pendingTopups = new Set(
    (await db()`select distinct plan_id from deposits where status in ('submitted','credited') and plan_id is not null`).map(
      (r) => r.plan_id as string
    )
  );
  for (const plan of plans.values()) {
    const waiting = plan.status !== "active" || pendingTopups.has(plan.id) || !plan.buffer_added;
    const due = now - (lastSync.get(plan.id) ?? 0) >= (waiting ? SYNC_EVERY_MS : 5 * SYNC_EVERY_MS);
    if (!due) continue;
    lastSync.set(plan.id, now);
    try {
      const next = await syncPlan(plan.user_id, plan.id);
      if (next.status !== plan.status) {
        markStale(plan.user_id);
        plans.set(plan.id, next);
      }
    } catch (e: any) {
      log(`[plan ${plan.id.slice(0, 8)}] sync failed:`, e.message);
    }
  }
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

async function main() {
  log(`Locke risk worker starting${config.demoAlerts ? " (DEMO alert levels)" : ""}`);
  priceStream.watch("ADA-USD");
  priceStream.watch("WTI-USD");
  priceStream.connect();
  await reloadPlans();
  await refreshPositions();

  const timers = [
    every(RELOAD_PLANS_MS, reloadPlans, "reload"),
    every(1_000, refreshPositions, "positions"),
    every(5_000, syncWaitingPlans, "sync"),
  ];

  const port = Number(process.env.PORT ?? 8080);
  const server = http
    .createServer((req, res) => {
      if (req.url === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, plans: plans.size, users: users.size, marks: Object.fromEntries(marks) }));
        return;
      }
      res.writeHead(404).end();
    })
    .listen(port, () => log(`health on :${port}/healthz`));

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log("shutting down");
    timers.forEach(clearInterval);
    priceStream.close();
    for (const u of users.values()) u.stream?.close();
    server.close();
    await db().end({ timeout: 5 });
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
