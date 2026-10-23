// Readiness check: is this deployment able to run real plans on Strike?
//
//   npm run strike:check              config, Strike REST + WebSockets, history, liquidity, database
//   npm run strike:check -- --signed  also a signed GET /v2/account and a user-stream logon, using
//                                     the most recently connected user's API wallet (needs the DB
//                                     and LOCKE_KEY_ENC, and someone to have connected once)
//
// Uses the app's own Strike client and signing, so it exercises the same code production runs.
// Exits non-zero when anything required fails.

import WebSocket from "ws";
import { estimateFill } from "../src/lib/domain/liquidity";
import { PLAN_MARKET } from "../src/lib/domain/plans";
import { config, ConfigError } from "../src/lib/server/config";
import { db } from "../src/lib/server/db";
import { strikeKeysFor } from "../src/lib/server/keys";
import { getAccount, getDailyCloses, getFeeRates, getMarketRules, getMarkPrice, getOrderBook } from "../src/lib/strike/client";
import { signLogon } from "../src/lib/strike/sign";

type Result = "ok" | "warn" | "fail" | "skip";
const results: Result[] = [];
const mark = { ok: "✓", warn: "!", fail: "✗", skip: "·" } as const;

function report(r: Result, what: string, detail = "") {
  results.push(r);
  console.log(`  ${mark[r]} ${what}${detail ? ` — ${detail}` : ""}`);
}

async function check(what: string, fn: () => Promise<{ r?: Result; detail?: string } | string | void>) {
  try {
    const out = await fn();
    if (typeof out === "string") report("ok", what, out);
    else report(out?.r ?? "ok", what, out?.detail);
  } catch (e) {
    report("fail", what, e instanceof Error ? e.message : String(e));
  }
}

function setting(name: string, get: () => unknown): Result {
  try {
    get();
    report("ok", name);
    return "ok";
  } catch (e) {
    report("fail", name, e instanceof ConfigError ? e.message : String(e));
    return "fail";
  }
}

/** Open a socket, send `first` on open, resolve with the first frame `match` accepts. */
function wsProbe(url: string, first: object | null, match: (m: any) => boolean, timeoutMs = 8_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`no answer within ${timeoutMs / 1000}s`));
    }, timeoutMs);
    ws.on("open", () => first && ws.send(JSON.stringify(first)));
    ws.on("message", (raw) => {
      for (const line of String(raw).split("\n")) {
        if (!line.trim()) continue;
        let m: any;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        for (const ev of Array.isArray(m) ? m : [m]) {
          if (match(ev)) {
            clearTimeout(timer);
            ws.close();
            resolve(ev);
            return;
          }
        }
      }
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

async function main() {
  const signed = process.argv.includes("--signed");
  console.log(`Locke readiness check · ${config.strikeApiUrl}\n`);

  console.log("Configuration");
  setting("STRIKE_BUILDER_CODE", () => config.builderCode);
  try {
    const bps = config.builderFeeBps;
    report(bps > 0 ? "ok" : "warn", "STRIKE_BUILDER_FEE_BPS", bps > 0 ? `${bps} bps per order` : "0: orders carry no builder fee");
  } catch (e) {
    report("fail", "STRIKE_BUILDER_FEE_BPS", (e as Error).message);
  }
  const hasDb = setting("DATABASE_URL", () => config.databaseUrl) === "ok";
  setting("LOCKE_KEY_ENC", () => config.keyEnc);
  setting("SESSION_SECRET", () => config.sessionSecret);
  report("ok", "Cardano network", config.networkId === 1 ? "mainnet" : `network id ${config.networkId}`);

  console.log("\nStrike REST");
  await check("Server clock", async () => {
    const r = await fetch(`${config.strikeApiUrl}/v2/time`);
    const { serverTime } = (await r.json()) as { serverTime: number };
    const skew = Math.abs(Date.now() - serverTime);
    // Signed requests must be within three minutes of Strike's clock.
    return { r: skew < 60_000 ? "ok" : skew < 180_000 ? "warn" : "fail", detail: `${(skew / 1000).toFixed(1)}s from this machine` };
  });
  await check("Fee tiers", async () => {
    const f = await getFeeRates();
    return `taker ${(f.takerRate * 100).toFixed(3)}%, builder ${f.builderBps} bps`;
  });

  for (const symbol of Object.values(PLAN_MARKET)) {
    console.log(`\n${symbol}`);
    let markPrice = 0;
    await check("Market rules", async () => {
      const r = await getMarketRules(symbol);
      return `step ${r.stepSize}, min ${r.minQty}, min notional $${r.minNotional}, ${r.tiers.length} margin tier(s)`;
    });
    await check("Mark price", async () => {
      const m = await getMarkPrice(symbol);
      markPrice = m.mark;
      return `${m.mark} (funding ${(m.fundingRate * 24 * 100).toFixed(3)}%/day)`;
    });
    await check("Order book", async () => {
      const book = await getOrderBook(symbol, { fresh: true });
      const side = (lv: [number, number][]) => lv.reduce((s, [p, q]) => s + p * q, 0);
      const bids = side(book.bids);
      const asks = side(book.asks);
      if (!book.bids.length || !book.asks.length) return { r: "fail", detail: "one side is empty" };
      // What a $10k hedge would cost to fill right now, both ways.
      const size = markPrice ? 10_000 / markPrice : 0;
      const sell = markPrice ? estimateFill(book, "sell", size, markPrice).slippage : null;
      const buy = markPrice ? estimateFill(book, "buy", size, markPrice).slippage : null;
      const slip = [sell, buy].map((s) => (s == null ? "—" : `${(s * 100).toFixed(3)}%`)).join(" / ");
      return { r: bids < 10_000 || asks < 10_000 ? "warn" : "ok", detail: `bids ${usd(bids)}, asks ${usd(asks)}; $10k sell/buy slippage ${slip}` };
    });
    await check("Price history", async () => {
      const closes = await getDailyCloses(symbol, 180);
      return { r: closes.length >= 30 ? "ok" : "warn", detail: `${closes.length} daily closes (replay asks for up to 180)` };
    });
  }

  console.log("\nStrike WebSockets");
  await check(`Price stream ${config.strikePriceWsUrl}`, async () => {
    const ev = await wsProbe(
      config.strikePriceWsUrl,
      { id: 1, method: "subscribe", channel: "markPrice@1s", symbol: "ADA-USD" },
      (m) => m?.e === "markPriceUpdate"
    );
    return `markPriceUpdate ${ev.s} ${ev.p}`;
  });

  console.log("\nDatabase");
  if (!hasDb) {
    report("skip", "Schema", "DATABASE_URL not set");
  } else {
    await check("Schema", async () => {
      const want = ["users", "strike_links", "connect_challenges", "plans", "deposits", "plan_events", "snapshots"];
      const rows = await db()`select table_name from information_schema.tables where table_schema = 'public'`;
      const have = new Set(rows.map((r) => r.table_name as string));
      const missing = want.filter((t) => !have.has(t));
      if (missing.length) return { r: "fail", detail: `missing ${missing.join(", ")}: run npm run db:migrate` };
      const [{ n }] = await db()`select count(*)::int as n from strike_links`;
      return `all ${want.length} tables; ${n} connected wallet(s)`;
    });
  }

  console.log("\nSigned (builder-connected API wallet)");
  if (!signed) {
    report("skip", "Signed requests", "run with --signed after the first wallet has connected");
  } else if (!hasDb) {
    report("fail", "Signed requests", "need DATABASE_URL to find a connected wallet");
  } else {
    const [link] = await db()`select user_id from strike_links order by updated_at desc limit 1`;
    if (!link) {
      report("fail", "Signed requests", "no wallet has connected yet: connect one in the app first");
    } else {
      const keys = await strikeKeysFor(link.user_id as string);
      await check("GET /v2/account", async () => {
        const a = await getAccount(keys);
        return `account ${keys.accountId}: balance $${parseFloat(a.wallet_balance).toFixed(2)}, available $${parseFloat(a.available_balance).toFixed(2)}`;
      });
      await check(`User stream logon ${config.strikeUserWsUrl}`, async () => {
        const ev = await wsProbe(
          config.strikeUserWsUrl,
          { id: 1, method: "session.logon", params: signLogon(keys, Date.now()) },
          (m) => m?.id === 1 || m?.e === "error"
        );
        if (ev.e === "error" || ev.status !== 200) throw new Error(`logon refused: ${ev.error?.msg ?? JSON.stringify(ev)}`);
        return "session.logon accepted";
      });
    }
  }

  const fails = results.filter((r) => r === "fail").length;
  const warns = results.filter((r) => r === "warn").length;
  console.log(`\n${fails ? `${fails} failed` : "Ready"}${warns ? `, ${warns} warning(s)` : ""}.`);
  if (hasDb) await db().end({ timeout: 2 });
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
