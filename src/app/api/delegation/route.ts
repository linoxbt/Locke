import { NextResponse } from "next/server";
import { config } from "@/lib/server/config";
import { db } from "@/lib/server/db";
import { HttpError } from "@/lib/server/errors";
import { route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

/** Where the user's ADA is staked and which DRep it votes through (Koios). Evidence, not a feature. */
export const GET = route(async (req: Request) => {
  const s = await requireSession(req);
  const [u] = await db()`select stake_address from users where id = ${s.uid}`;
  if (!u?.stake_address) return NextResponse.json({ delegation: null });
  const post = (path: string, body: object) =>
    fetch(`${config.koiosUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    }).then((r) => {
      if (!r.ok) throw new HttpError(502, "Cardano data is unavailable right now");
      return r.json();
    });
  const [acct] = await post("/account_info", { _stake_addresses: [u.stake_address] });
  let poolTicker: string | null = null;
  if (acct?.delegated_pool) {
    const [pool] = await post("/pool_info", { _pool_bech32_ids: [acct.delegated_pool] });
    poolTicker = pool?.meta_json?.ticker ?? null;
  }
  return NextResponse.json({
    delegation: {
      stakeAddress: u.stake_address,
      pool: acct?.delegated_pool ?? null,
      poolTicker,
      drep: acct?.delegated_drep ?? null,
      totalLovelace: acct?.total_balance ?? null,
    },
  });
});
