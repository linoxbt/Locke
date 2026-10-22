import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { route } from "@/lib/server/http";
import { strikeKeysFor } from "@/lib/server/keys";
import { currentSession } from "@/lib/server/session";
import { getAccount } from "@/lib/strike/client";

export const GET = route(async () => {
  const s = await currentSession();
  if (!s) return NextResponse.json({ user: null });
  const [u] = await db()`select u.id, u.address, u.stake_address, l.account_id from users u
                         left join strike_links l on l.user_id = u.id where u.id = ${s.uid}`;
  if (!u) return NextResponse.json({ user: null });
  let balance: { wallet: number; available: number } | null = null;
  try {
    const acct = await getAccount(await strikeKeysFor(u.id));
    balance = { wallet: parseFloat(acct.wallet_balance) || 0, available: parseFloat(acct.available_balance) || 0 };
  } catch {
    /* Strike unreachable or connection expired: show the user without a balance */
  }
  return NextResponse.json({
    user: { address: u.address, stakeAddress: u.stake_address, accountId: u.account_id, balance },
  });
});
