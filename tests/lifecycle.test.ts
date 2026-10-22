// Integration test: the plan lifecycle against Postgres and a mock Strike API.
// Runs only when TEST_DATABASE_URL is set (a throwaway database; tables are created and truncated).
//   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/locke_test npm test

import { createHash, createPublicKey, verify } from "node:crypto";
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB = process.env.TEST_DATABASE_URL;

// ── Mock Strike ──
const state = {
  available: 0,
  position: null as null | { size: number; entry: number; iso: number },
  orders: [] as any[],
  isoAdds: [] as number[],
  deposits: new Map<string, { usd: number; tx?: string }>(),
  marginMode: "cross",
  badSignatures: 0,
};
const MARK = 0.2;
const SPKI = Buffer.from("302a300506032b6570032100", "hex");

function checkSignature(req: http.IncomingMessage, body: string) {
  const pub = String(req.headers["x-api-wallet-public-key"] ?? "");
  const sig = String(req.headers["x-api-wallet-signature"] ?? "");
  const msg = `${req.method}:${req.url}:${req.headers["x-api-wallet-timestamp"]}:${req.headers["x-api-wallet-nonce"]}:${createHash("sha256").update(body).digest("hex")}`;
  const key = createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(pub, "hex")]), format: "der", type: "spki" });
  if (!verify(null, Buffer.from(msg), key, Buffer.from(sig, "hex"))) state.badSignatures++;
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url!, "http://x");
    const json = (o: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(o));
    };
    const b = body ? JSON.parse(body) : {};
    if (req.headers["x-api-wallet-public-key"]) checkSignature(req, body);
    switch (`${req.method} ${url.pathname}`) {
      case "GET /v2/time":
        return json({ serverTime: Date.now() });
      case "GET /price/v2/markPrice":
        return json({ s: url.searchParams.get("symbol"), p: String(MARK), i: String(MARK), r: "0.00001", T: 0 });
      case "GET /price/v2/exchangeInfo":
        return json({
          symbols: [
            {
              symbol: "ADA-USD",
              status: "trading",
              filters: [
                { filterType: "MARKET_LOT_SIZE", stepSize: "1", minQty: "1" },
                { filterType: "MIN_NOTIONAL", notional: "10" },
              ],
            },
          ],
        });
      case "GET /v2/markets":
        return json({ markets: { "ADA-USD": { margin_tiers: [{ max_notional: "10000", max_leverage: 40, maintenance_margin_rate: "0.005", maintenance_amount: "0" }] } } });
      case "GET /v2/fee-tiers":
        return json({ feeTiers: [{ Tier: 0, TakerRate: 0.0005, MakerRate: 0 }] });
      case "GET /v2/account":
        return json({ wallet_balance: String(state.available), available_balance: String(state.available) });
      case "POST /v2/deposit/quote": {
        const id = `req-${state.deposits.size + 1}`;
        const usd = (Number(b.asset_amount) / 1e6) * MARK * 0.995;
        state.deposits.set(id, { usd });
        return json({ request_id: id, quote: { usd_value: usd.toFixed(2), expiration_at: Date.now() + 60_000 } });
      }
      case "POST /v2/deposit/build-tx":
        return json({ unsigned_tx: "84a0a0f5f6", format: "cardano_cbor", expires_at: Date.now() + 1e6 });
      case "POST /v2/deposit": {
        const d = state.deposits.get(b.request_id)!;
        d.tx = b.tx_hash;
        state.available += d.usd; // credited instantly in the mock
        return json({ request_id: b.request_id, status: "pending" });
      }
      case "GET /v2/history/transaction":
        return json({
          transactions: [...state.deposits.entries()]
            .filter(([, d]) => d.tx)
            .map(([id, d], i) => ({ id: i, type: "deposit", amount: d.usd.toFixed(2), tx_hash: d.tx, status: "completed", request_id: id })),
        });
      case "POST /v2/marginMode":
        state.marginMode = b.marginMode;
        return json({ symbol: b.symbol, marginMode: b.marginMode });
      case "GET /v2/symbols":
        return json({ symbol_settings: { "ADA-USD": { margin_mode: state.marginMode, leverage: 1 } } });
      case "POST /v2/leverage":
        return json({ symbol: b.symbol, leverage: b.leverage });
      case "POST /v2/order": {
        state.orders.push({ ...b, fee: req.headers["x-builder-fee-bps"] });
        const size = Number(b.size) * (b.side === "sell" ? -1 : 1);
        if (b.reduce_only) state.position = null;
        else {
          state.position = { size, entry: MARK, iso: Math.abs(size) * MARK };
          state.available -= Math.abs(size) * MARK;
        }
        return json({ client_order_id: b.client_order_id, status: "pending" }, 201);
      }
      case "POST /v2/isoMargin":
        state.isoAdds.push(Number(b.amount));
        if (state.position) state.position.iso += Number(b.amount);
        state.available -= Number(b.amount);
        return json({ symbol: b.symbol, request_id: "m1" });
      case "GET /v2/positions": {
        const p = state.position;
        return json({
          positions: p
            ? [{ symbol: "ADA-USD", size: String(p.size), entry_price: String(p.entry), iso_balance: String(p.iso), leverage: 1, margin_mode: "isolated", accumulated_funding_fees: "0", upnl: "0", maintenance_margin: "1", liquidation_price: "0.39", id: 1 }]
            : [],
        });
      }
    }
    json({ error: `mock: unhandled ${req.method} ${url.pathname}` }, 404);
  });
});

describe.skipIf(!DB)("plan lifecycle (Postgres + mock Strike)", () => {
  let svc: typeof import("@/lib/server/planService");
  let sql: any;
  let userId: string;

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, r));
    process.env.STRIKE_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.DATABASE_URL = DB;
    process.env.LOCKE_KEY_ENC = "cd".repeat(32);
    process.env.STRIKE_BUILDER_FEE_BPS = "5";
    const { db } = await import("@/lib/server/db");
    sql = db();
    await sql.unsafe(readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8"));
    await sql`truncate users, strike_links, plans, deposits, plan_events, snapshots, connect_challenges cascade`;
    const { encryptSecret, generateApiWalletKeys } = await import("@/lib/server/secrets");
    const k = generateApiWalletKeys();
    [{ id: userId }] = await sql`insert into users (address) values ('addr1test') returning id`;
    await sql`insert into strike_links (user_id, account_id, api_wallet_public_key, api_wallet_secret_enc, fee_share_bps)
              values (${userId}, 'acct', ${k.publicKey}, ${encryptSecret(k.privateKey)}, 5)`;
    svc = await import("@/lib/server/planService");
  });

  afterAll(async () => {
    server.close();
    await sql?.end();
  });

  it("opens, buffers, tops up and closes a holdings plan exactly once", async () => {
    const { plan, preview } = await svc.createDraft(userId, "holdings", { amountHeld: 1000, sharePct: 100, leverage: 1, bufferPct: 25 });
    expect(preview.sizing.size).toBe(1000);
    expect(preview.sizing.marginUsd).toBeCloseTo(250);

    const dep = await svc.prepareDeposit(userId, plan.id, "open", { address: "addr1test", utxos: ["8282"] });
    expect(dep.needed).toBe(true);
    expect(dep.usdValue!).toBeGreaterThanOrEqual(preview.sizing.requiredUsd);
    await expect(svc.prepareDeposit(userId, plan.id, "open", { address: "addr1test", utxos: ["8282"] })).resolves.toBeTruthy();

    await svc.confirmDeposit(userId, dep.depositId!, "ab".repeat(32));
    expect((await svc.loadPlan(userId, plan.id)).status).toBe("funding");
    // A second open deposit while one is confirming is refused.
    await expect(svc.prepareDeposit(userId, plan.id, "open", { address: "addr1test", utxos: ["8282"] })).rejects.toThrow(/still confirming/);

    // Worker and browser sync at the same time: one order, one buffer add.
    await Promise.all([svc.syncPlan(userId, plan.id), svc.syncPlan(userId, plan.id)]);
    await Promise.all([svc.syncPlan(userId, plan.id), svc.syncPlan(userId, plan.id)]);
    const active = await svc.loadPlan(userId, plan.id);
    expect(active.status).toBe("active");
    expect(state.marginMode).toBe("isolated");
    expect(state.orders.filter((o) => !o.reduce_only)).toHaveLength(1);
    expect(state.orders[0]).toMatchObject({ symbol: "ADA-USD", side: "sell", type: "market", size: "1000", fee: "5" });
    expect(state.orders[0].client_order_id).toMatch(new RegExp(`^locke-${plan.id}-open-`));
    expect(state.isoAdds).toHaveLength(1);
    expect(state.isoAdds[0]).toBeCloseTo(50, 1);

    const { getPosition } = await import("@/lib/strike/client");
    const { strikeKeysFor } = await import("@/lib/server/keys");
    const view = await svc.planView(active, await getPosition(await strikeKeysFor(userId), "ADA-USD"));
    expect(view.position?.size).toBe(1000);
    expect(view.position?.isoBalance).toBeCloseTo(250, 0);
    expect(view.riskLevel).toBe("ok");
    expect(view.fundingPerDay).toBeGreaterThan(0); // short receives when the rate is positive

    // Top-up: deposit credited → added to this plan's isolated margin once.
    const top = await svc.prepareDeposit(userId, plan.id, "topup", { address: "addr1test", utxos: ["8282"], amountUsd: 20 });
    await svc.confirmDeposit(userId, top.depositId!, "cd".repeat(32));
    await Promise.all([svc.syncPlan(userId, plan.id), svc.syncPlan(userId, plan.id)]);
    expect(state.isoAdds).toHaveLength(2);
    expect(state.isoAdds[1]).toBeGreaterThanOrEqual(19.9);

    await svc.closePlan(userId, plan.id);
    expect(state.orders.at(-1)).toMatchObject({ side: "buy", reduce_only: true });
    const closed = await svc.syncPlan(userId, plan.id);
    expect(closed.status).toBe("closed");

    const events = await sql`select message from plan_events where plan_id = ${plan.id} order by id`;
    const msgs = events.map((e: any) => e.message);
    expect(msgs.filter((m: string) => m.startsWith("Hedge open"))).toHaveLength(1);
    expect(msgs.filter((m: string) => m.startsWith("Plan closed"))).toHaveLength(1);
    expect(state.badSignatures).toBe(0);
  });

  it("refuses a second live plan on the same market", async () => {
    state.position = null;
    const a = await svc.createDraft(userId, "holdings", { amountHeld: 1000, sharePct: 100 });
    await sql`update plans set status = 'active' where id = ${a.plan.id}`;
    const b = await svc.createDraft(userId, "holdings", { amountHeld: 2000, sharePct: 50 });
    await expect(svc.prepareDeposit(userId, b.plan.id, "open", { address: "addr1test", utxos: ["8282"] })).rejects.toThrow(/already have a live plan/);
  });
});
