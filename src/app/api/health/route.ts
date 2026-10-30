import { NextResponse } from "next/server";
import { config } from "@/lib/server/config";
import { db } from "@/lib/server/db";
import { getMarkPrice } from "@/lib/strike/client";

export const dynamic = "force-dynamic";

/** Unauthenticated, so the answer is reused for a few seconds: hammering it can't fan out to the database and Strike. */
const TTL_MS = 15_000;
let last: { at: number; ok: Promise<boolean> } | null = null;

/** A heartbeat (1: Strike worker or sweep, 2: Base keeper) older than this means it stopped. */
const HEARTBEAT_STALE_S = 300;

async function fresh(id: number) {
  const [row] = await db()`select extract(epoch from now() - at)::float8 as age from monitor_heartbeat where id = ${id}`;
  if (!row || Number(row.age) > HEARTBEAT_STALE_S) throw new Error(`heartbeat ${id} is stale`);
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
    builderCode: await check(() => config.builderCode),
    builderFee: await check(() => config.builderFeeBps),
    sessionSecret: await check(() => config.sessionSecret),
    keyEncryption: await check(() => config.keyEnc),
    database: await check(() =>
      Promise.race([db()`select 1`, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000))])
    ),
    strike: await check(() => getMarkPrice("ADA-USD")),
    // Risk monitoring runs: the worker or the scheduled sweep wrote its heartbeat recently.
    monitoring: await check(() => fresh(1)),
    // Once Locke on Base is live, its keeper must be running too.
    baseKeeper: config.baseFactoryAddress ? await check(() => fresh(2)) : true,
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
