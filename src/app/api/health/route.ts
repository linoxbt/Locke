import { NextResponse } from "next/server";
import { config } from "@/lib/server/config";
import { db } from "@/lib/server/db";
import { getMarkets } from "@/lib/veranta/client";

export const dynamic = "force-dynamic";

/** Unauthenticated, so the answer is reused for a few seconds: hammering it can't fan out to the database and Avantis. */
const TTL_MS = 15_000;
let last: { at: number; ok: Promise<boolean> } | null = null;

/** The Base keeper's heartbeat (row 2) older than this means it stopped. */
const HEARTBEAT_STALE_S = 300;

/** The keeper's last round finished recently, and it isn't failing vaults, short of gas or revoked. */
async function keeperWell() {
  const [row] = await db()`select extract(epoch from now() - at)::float8 as age, result from monitor_heartbeat where id = 2`;
  if (!row || Number(row.age) > HEARTBEAT_STALE_S) throw new Error("keeper heartbeat is stale");
  const r = (row.result ?? {}) as { failing?: number; gasLow?: boolean; keeperRevoked?: boolean };
  if ((r.failing ?? 0) > 0 || r.gasLow || r.keeperRevoked) throw new Error("keeper reports a problem");
}

async function compute(): Promise<boolean> {
  const check = async (fn: () => unknown | Promise<unknown>) => {
    try {
      await fn();
      return true;
    } catch {
      return false;
    }
  };
  const checks = {
    sessionSecret: await check(() => config.sessionSecret),
    database: await check(() =>
      Promise.race([db()`select 1`, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000))])
    ),
    avantis: await check(() => getMarkets()),
    // Once Locke on Base is live, its keeper must be running.
    baseKeeper: config.baseFactoryAddress ? await check(keeperWell) : true,
  };
  const ok = Object.values(checks).every(Boolean);
  if (!ok) console.error("[health] failing:", Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(", "));
  return ok;
}

/**
 * Readiness for uptime checks: 200 when everything a user needs works, 503 otherwise. The public
 * answer is just {ok}; which piece failed goes to the server log, not to visitors.
 */
export async function GET() {
  // Concurrent hits share the one in-flight check.
  if (!last || Date.now() - last.at > TTL_MS) last = { at: Date.now(), ok: compute() };
  const ok = await last.ok;
  return NextResponse.json({ ok }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
