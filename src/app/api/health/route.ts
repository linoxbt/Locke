import { NextResponse } from "next/server";
import { basePublicClient } from "@/lib/server/baseChain";
import { config } from "@/lib/server/config";
import { db } from "@/lib/server/db";
import { getMarkets } from "@/lib/veranta/client";

export const dynamic = "force-dynamic";

/** Unauthenticated, so the answer is reused for a few seconds: hammering it can't fan out to the database and Veranta. */
const TTL_MS = 15_000;
let last: { at: number; result: Promise<{ ok: boolean; degraded: boolean }> } | null = null;

/** The Base keeper's heartbeat (row 2) older than this means it stopped. */
const HEARTBEAT_STALE_S = 300;

const within = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

/**
 * The keeper's last round finished recently, and it isn't failing vaults, short of gas or revoked.
 * Returns what else it reported (a revoke or income round failing, gas getting low): degraded, not down.
 */
async function keeperWell(): Promise<string[]> {
  const [row] = await db()`select extract(epoch from now() - at)::float8 as age, result from monitor_heartbeat where id = 2`;
  if (!row || Number(row.age) > HEARTBEAT_STALE_S) throw new Error("keeper heartbeat is stale");
  const r = (row.result ?? {}) as { failing?: number; gasLow?: boolean; keeperRevoked?: boolean; problems?: unknown };
  if ((r.failing ?? 0) > 0 || r.gasLow || r.keeperRevoked) throw new Error("keeper reports a problem");
  return Array.isArray(r.problems) ? r.problems.map(String) : [];
}

async function compute(): Promise<{ ok: boolean; degraded: boolean }> {
  const check = async (fn: () => unknown | Promise<unknown>) => {
    try {
      await fn();
      return true;
    } catch {
      return false;
    }
  };
  let problems: string[] = [];
  const checks = {
    sessionSecret: await check(() => config.sessionSecret),
    database: await check(() => within(db()`select 1`, 3000)),
    veranta: await check(() => getMarkets()),
    // Every page reads Base: a cheap call, with a short wait.
    baseRpc: await check(() => within(basePublicClient().getBlockNumber({ cacheTime: 0 }), 3000)),
    // Once Locke on Base is live, its keeper must be running.
    baseKeeper: config.baseFactoryAddress ? await check(async () => (problems = await keeperWell())) : true,
  };
  const ok = Object.values(checks).every(Boolean);
  if (!ok) console.error("[health] failing:", Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(", "));
  if (problems.length) console.warn("[health] the keeper reports:", problems.join("; "));
  return { ok, degraded: ok && problems.length > 0 };
}

/**
 * Readiness for uptime checks: 200 when everything a user needs works, 503 otherwise. `degraded`
 * means it works but the keeper reported a problem to look at. The public answer is just that;
 * which piece failed goes to the server log, not to visitors.
 */
export async function GET() {
  // Concurrent hits share the one in-flight check.
  if (!last || Date.now() - last.at > TTL_MS) last = { at: Date.now(), result: compute() };
  const { ok, degraded } = await last.result;
  return NextResponse.json({ ok, degraded }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
