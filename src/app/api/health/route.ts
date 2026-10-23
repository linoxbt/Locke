import { NextResponse } from "next/server";
import { config } from "@/lib/server/config";
import { db } from "@/lib/server/db";
import { getMarkPrice } from "@/lib/strike/client";

export const dynamic = "force-dynamic";

/**
 * Readiness for uptime checks: 200 when everything a user needs works, 503 otherwise. The public
 * answer is just {ok}; which piece failed goes to the server log, not to visitors.
 */
export async function GET() {
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
  };
  const ok = Object.values(checks).every(Boolean);
  if (!ok) console.error("[health] failing:", Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(", "));
  return NextResponse.json({ ok }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
