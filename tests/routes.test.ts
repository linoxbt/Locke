import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addressBytes, bech, signData, walletKey } from "./helpers/cip30";

// Route handlers run against Request objects with the database, Strike and the cookie jar faked.
const h = vi.hoisted(() => {
  type Q = { text: string; values: unknown[] };
  const state = {
    queries: [] as Q[],
    answer: (() => []) as (q: Q) => unknown[],
    jar: {} as Record<string, string>,
  };
  const sql = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = { text: strings.join("?").replace(/\s+/g, " ").trim(), values };
      state.queries.push(q);
      try {
        return Promise.resolve(state.answer(q));
      } catch (e) {
        return Promise.reject(e);
      }
    },
    { begin: async (fn: (tx: unknown) => unknown) => fn(sql), json: (v: unknown) => v }
  );
  return { state, sql };
});

vi.mock("@/lib/server/db", () => ({ db: () => h.sql }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (h.state.jar[n] ? { name: n, value: h.state.jar[n] } : undefined) }),
}));
vi.mock("@/lib/strike/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/strike/client")>()),
  requestBuilderSignature: vi.fn(),
  verifyBuilderSignature: vi.fn(),
  withdrawConfirm: vi.fn(),
  withdrawQuote: vi.fn(),
  getAccount: vi.fn(),
}));
vi.mock("@/lib/server/planService", () => ({
  prepareDeposit: vi.fn(async () => ({ needed: false, availableUsd: 0 })),
  syncPlan: vi.fn(async () => ({ status: "active", status_note: null })),
  reservedUsd: vi.fn(async () => 0),
}));

const strike = await import("@/lib/strike/client");
const planService = await import("@/lib/server/planService");

const UID = "d4c55f6c-e759-498c-a3e0-c1019528c119";
const PLAN = "0b3e1a52-6a43-4c1e-9d0e-2f4a8c0e7b11";
const ORIGIN = { origin: "https://locke.example", host: "locke.example" };
const post = (path: string, body: unknown, headers: Record<string, string> = ORIGIN) =>
  new Request(`https://locke.example${path}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const ran = (re: RegExp) => h.state.queries.filter((q) => re.test(q.text));

beforeAll(() => {
  process.env.LOCKE_KEY_ENC = "ab".repeat(32);
  process.env.SESSION_SECRET = "s".repeat(40);
  process.env.STRIKE_BUILDER_CODE = "LockeIn";
  process.env.STRIKE_BUILDER_FEE_BPS = "10";
});

beforeEach(() => {
  h.state.queries = [];
  h.state.answer = () => [];
  h.state.jar = {};
  vi.mocked(strike.requestBuilderSignature).mockReset();
  vi.mocked(strike.verifyBuilderSignature).mockReset();
  vi.mocked(strike.withdrawConfirm).mockReset();
  vi.mocked(strike.withdrawQuote).mockReset();
  vi.mocked(strike.getAccount).mockReset();
  vi.mocked(planService.reservedUsd).mockReset().mockResolvedValue(0);
  vi.mocked(planService.prepareDeposit).mockClear();
});

async function signIn(addr = bech(addressBytes(walletKey().pub))) {
  const { encodeSession } = await import("@/lib/server/session");
  h.state.jar["__Host-locke_session"] = encodeSession({ uid: UID, addr, v: 1 });
  return addr;
}
const sessionRows = (q: { text: string }) => (/select session_version from users/.test(q.text) ? [{ session_version: 1 }] : null);

describe("POST /api/connect/finish", () => {
  const message = "Sign to connect Locke to Strike\nnonce: abc";
  const alice = walletKey();
  const aliceAddr = bech(addressBytes(alice.pub));

  function challengeDb(existingAccount?: string) {
    h.state.answer = (q) => {
      if (/^delete from connect_challenges/.test(q.text)) {
        return [{ nonce: "n1", address: aliceAddr, stake_address: null, api_wallet_public_key: "ab".repeat(32), api_wallet_secret_enc: "v2.x", fee_share_bps: 10, message }];
      }
      if (/insert into users/.test(q.text)) return [{ id: UID, address: aliceAddr, session_version: 3 }];
      if (/select account_id from strike_links/.test(q.text)) return existingAccount ? [{ account_id: existingAccount }] : [];
      return [];
    };
  }

  it("signs in when the wallet signed the stored challenge, with a __Host- Secure cookie", async () => {
    challengeDb("acct-1");
    vi.mocked(strike.verifyBuilderSignature).mockResolvedValue({ account_id: "acct-1", api_wallet_public_key: "ab".repeat(32), api_wallet_expired_at: "9999-12-31T23:59:59Z" });
    const { POST } = await import("@/app/api/connect/finish/route");
    const res = await POST(post("/api/connect/finish", { nonce: "n1", signature: signData(alice, addressBytes(alice.pub), message) }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/__Host-locke_session=[^;]+;/);
    expect(cookie).toMatch(/Secure/);
    // Year-9999 expiry is stored as "never".
    const link = ran(/insert into strike_links/)[0];
    expect(link.values[5]).toBeNull();
  });

  it("stores a real ISO expiry", async () => {
    challengeDb();
    vi.mocked(strike.verifyBuilderSignature).mockResolvedValue({ account_id: "acct-1", api_wallet_public_key: "ab".repeat(32), api_wallet_expired_at: "2027-05-01T00:00:00Z" });
    const { POST } = await import("@/app/api/connect/finish/route");
    expect((await POST(post("/api/connect/finish", { nonce: "n1", signature: signData(alice, addressBytes(alice.pub), message) }))).status).toBe(200);
    expect(ran(/insert into strike_links/)[0].values[5]).toEqual(new Date("2027-05-01T00:00:00Z"));
  });

  it("refuses another wallet's signature without asking Strike", async () => {
    challengeDb();
    const mallory = walletKey();
    const { POST } = await import("@/app/api/connect/finish/route");
    const res = await POST(post("/api/connect/finish", { nonce: "n1", signature: signData(mallory, addressBytes(mallory.pub), message) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/isn't from this wallet address/);
    expect(strike.verifyBuilderSignature).not.toHaveBeenCalled();
    expect(ran(/insert into users/)).toHaveLength(0);
  });

  it("refuses when Strike returns a different account than the user already has", async () => {
    challengeDb("acct-1");
    vi.mocked(strike.verifyBuilderSignature).mockResolvedValue({ account_id: "acct-2", api_wallet_public_key: "ab".repeat(32) });
    const { POST } = await import("@/app/api/connect/finish/route");
    const res = await POST(post("/api/connect/finish", { nonce: "n1", signature: signData(alice, addressBytes(alice.pub), message) }));
    expect(res.status).toBe(409);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(ran(/insert into strike_links/)).toHaveLength(0);
  });
});

describe("POST /api/connect/start", () => {
  const addr = bech(addressBytes(walletKey().pub));
  const counts = (global: number, by_network: number) => (q: { text: string }) => (/count\(\*\)/.test(q.text) ? [{ global, by_network }] : []);

  it("reserves the attempt under a lock, by network, then stores Strike's message", async () => {
    h.state.answer = counts(0, 0);
    vi.mocked(strike.requestBuilderSignature).mockResolvedValue({ nonce: "n9", message_to_sign: "hello" });
    const { POST } = await import("@/app/api/connect/start/route");
    const res = await POST(post("/api/connect/start", { address: addr }, { ...ORIGIN, "x-nf-client-connection-ip": "2001:db8:1:2:aaaa::5" }));
    expect(res.status).toBe(200);
    const texts = h.state.queries.map((q) => q.text);
    const lock = texts.findIndex((t) => /pg_advisory_xact_lock/.test(t));
    const insert = texts.findIndex((t) => /insert into connect_challenges/.test(t));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(lock);
    const ins = h.state.queries[insert].values;
    expect(String(ins[0])).toMatch(/^pending:/);
    expect(ins[6]).toBe("2001:db8:1:2::/64");
    const upd = ran(/update connect_challenges set nonce/)[0];
    expect(upd.values.slice(0, 2)).toEqual(["n9", "hello"]);
  });

  it("429s a busy network or a busy minute before calling Strike", async () => {
    const { POST } = await import("@/app/api/connect/start/route");
    for (const [g, n] of [[0, 20], [120, 0]]) {
      h.state.answer = counts(g, n);
      const res = await POST(post("/api/connect/start", { address: addr }, { ...ORIGIN, "x-nf-client-connection-ip": "198.51.100.4" }));
      expect(res.status).toBe(429);
    }
    expect(strike.requestBuilderSignature).not.toHaveBeenCalled();
  });
});

describe("strikeKeysFor", () => {
  it("re-encrypts a v1 secret as v2, only over the exact old ciphertext", async () => {
    const { createCipheriv, randomBytes } = await import("node:crypto");
    const { decryptSecret } = await import("@/lib/server/secrets");
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", Buffer.from("ab".repeat(32), "hex"), iv);
    const ct = Buffer.concat([c.update("cafe", "utf8"), c.final()]);
    const v1 = ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
    h.state.answer = (q) =>
      /from strike_links/.test(q.text)
        ? [{ account_id: "a", api_wallet_public_key: "pub", api_wallet_secret_enc: v1, fee_share_bps: 10, expires_at: null }]
        : [];
    const { strikeKeysFor } = await import("@/lib/server/keys");
    expect((await strikeKeysFor(UID)).privateKey).toBe("cafe");
    const [upd] = ran(/update strike_links set api_wallet_secret_enc/);
    expect(upd.text).toMatch(/where user_id = \? and api_wallet_secret_enc = \?/);
    const [newEnc, , oldEnc] = upd.values as string[];
    expect(newEnc.startsWith("v2.")).toBe(true);
    expect(decryptSecret(newEnc, "pub")).toBe("cafe");
    expect(oldEnc).toBe(v1);

    // v2 rows are left alone.
    h.state.queries = [];
    h.state.answer = (q) =>
      /from strike_links/.test(q.text)
        ? [{ account_id: "a", api_wallet_public_key: "pub", api_wallet_secret_enc: newEnc, fee_share_bps: 10, expires_at: null }]
        : [];
    expect((await strikeKeysFor(UID)).privateKey).toBe("cafe");
    expect(ran(/update strike_links/)).toHaveLength(0);
  });
});

describe("POST /api/plans/[id]/deposit", () => {
  const key = walletKey();
  const stake = new Uint8Array(28).fill(5);
  const main = bech(addressBytes(key.pub, { stake }));

  it("accepts another payment address of the same account and an empty UTxO list", async () => {
    await signIn(main);
    h.state.answer = (q) => sessionRows(q) ?? [];
    const { POST } = await import("@/app/api/plans/[id]/deposit/route");
    const sibling = bech(addressBytes(walletKey().pub, { stake }));
    const res = await POST(post(`/api/plans/${PLAN}/deposit`, { address: sibling, utxos: [] }), ctx(PLAN));
    expect(res.status).toBe(200);
    expect(vi.mocked(planService.prepareDeposit).mock.calls[0][3]).toMatchObject({ address: sibling, utxos: [] });
    // No address: the signed-in one.
    await POST(post(`/api/plans/${PLAN}/deposit`, {}), ctx(PLAN));
    expect(vi.mocked(planService.prepareDeposit).mock.calls[1][3]).toMatchObject({ address: main });
  });

  it("refuses other wallets, bad UTxO lists and malformed ids before planService", async () => {
    await signIn(main);
    h.state.answer = (q) => sessionRows(q) ?? [];
    const { POST } = await import("@/app/api/plans/[id]/deposit/route");
    const other = bech(addressBytes(walletKey().pub, { stake: new Uint8Array(28).fill(6) }));
    expect((await POST(post(`/api/plans/${PLAN}/deposit`, { address: other }), ctx(PLAN))).status).toBe(403);
    for (const utxos of [Array(301).fill("00"), ["zz"], ["0".repeat(20_002)], [1], "00"]) {
      expect((await POST(post(`/api/plans/${PLAN}/deposit`, { utxos }), ctx(PLAN))).status).toBe(400);
    }
    for (const id of ["not-a-uuid", "------------------------------------", `${PLAN}x`]) {
      expect((await POST(post(`/api/plans/${id}/deposit`, {}), ctx(id))).status).toBe(404);
    }
    expect(planService.prepareDeposit).not.toHaveBeenCalled();
  });
});

describe("rate limits on authenticated routes", () => {
  it("answers 429 once a user's sync budget is spent", async () => {
    await signIn();
    h.state.answer = (q) => sessionRows(q) ?? [];
    const { POST } = await import("@/app/api/plans/[id]/sync/route");
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) statuses.push((await POST(post(`/api/plans/${PLAN}/sync`, {}), ctx(PLAN))).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

describe("POST /api/withdraw/quote", () => {
  it("won't withdraw money credited for a plan's funding or a pending top-up", async () => {
    const { encryptSecret } = await import("@/lib/server/secrets");
    const enc = encryptSecret("cafe", "pub");
    const addr = await signIn();
    h.state.answer = (q) =>
      sessionRows(q) ??
      (/from strike_links/.test(q.text) ? [{ account_id: "a", api_wallet_public_key: "pub", api_wallet_secret_enc: enc, fee_share_bps: 10, expires_at: null }] : []);
    vi.mocked(strike.getAccount).mockResolvedValue({ wallet_balance: "100", available_balance: "100" });
    vi.mocked(planService.reservedUsd).mockResolvedValue(70);
    vi.mocked(strike.withdrawQuote).mockResolvedValue({ withdraw_id: "w1", fee: "1", message_to_sign: "aa" });
    const { POST } = await import("@/app/api/withdraw/quote/route");

    const refused = await POST(post("/api/withdraw/quote", { usd: 50 }));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatch(/Only \$30\.00 is free.*\$70\.00 .*set aside/);
    expect(strike.withdrawQuote).not.toHaveBeenCalled();

    const ok = await POST(post("/api/withdraw/quote", { usd: 30 }));
    expect(ok.status).toBe(200);
    expect(vi.mocked(strike.withdrawQuote).mock.calls[0].slice(1)).toEqual([30, addr]);
  });
});

describe("POST /api/withdraw/confirm", () => {
  it("marks the quote failed only when Strike definitely refused (4xx)", async () => {
    const { encryptSecret } = await import("@/lib/server/secrets");
    const enc = encryptSecret("cafe", "pub");
    await signIn();
    h.state.answer = (q) =>
      sessionRows(q) ??
      (/select status from withdrawals/.test(q.text)
        ? [{ status: "quoted" }]
        : /from strike_links/.test(q.text)
          ? [{ account_id: "a", api_wallet_public_key: "pub", api_wallet_secret_enc: enc, fee_share_bps: 10, expires_at: null }]
          : []);
    const { StrikeError } = strike;
    const { POST } = await import("@/app/api/withdraw/confirm/route");
    const body = { withdrawId: "w1", signature: "aa:bb" };

    vi.mocked(strike.withdrawConfirm).mockRejectedValueOnce(new StrikeError("insufficient balance", 400, { error: "insufficient balance" }));
    const refused = await POST(post("/api/withdraw/confirm", body));
    expect(refused.status).toBe(400);
    expect(ran(/set status = 'failed'/)).toHaveLength(1);

    h.state.queries = [];
    vi.mocked(strike.withdrawConfirm).mockRejectedValueOnce(new StrikeError("Strike didn't answer in time", 504, null));
    const unknown = await POST(post("/api/withdraw/confirm", body));
    expect(unknown.status).toBe(502);
    expect((await unknown.json()).error).toMatch(/Check your Strike balance/);
    expect(ran(/set status = 'failed'/)).toHaveLength(0);
  });
});

describe("page gate", () => {
  it("sends an ended session to /connect?reconnect=1, a first visit without it", async () => {
    const { requirePageSession } = await import("@/lib/server/pageAuth");
    const target = async () => {
      try {
        await requirePageSession("/portfolio");
      } catch (e) {
        return String((e as { digest?: string }).digest);
      }
      return "no redirect";
    };
    h.state.jar = { "__Host-locke_session": "forged.value" };
    expect(await target()).toMatch(/\/connect\?reconnect=1&next=%2Fportfolio/);
    h.state.jar = {};
    const first = await target();
    expect(first).toMatch(/\/connect\?next=%2Fportfolio/);
    expect(first).not.toMatch(/reconnect/);
  });
});
