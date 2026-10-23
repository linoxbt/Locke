import { createHash, createPublicKey, verify } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { signLogon, signRequestHeaders } from "@/lib/strike/sign";

beforeAll(() => {
  process.env.LOCKE_KEY_ENC = "ab".repeat(32);
  process.env.SESSION_SECRET = "s".repeat(40);
});

const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const verifyHex = (msg: string, sigHex: string, pubHex: string) =>
  verify(null, Buffer.from(msg), createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(pubHex, "hex")]), format: "der", type: "spki" }), Buffer.from(sigHex, "hex"));

describe("Strike request signing", () => {
  it("signs METHOD:PATH:TS:NONCE:SHA256(body) with the API wallet key", async () => {
    const { generateApiWalletKeys } = await import("@/lib/server/secrets");
    const keys = generateApiWalletKeys();
    expect(keys.publicKey).toMatch(/^[0-9a-f]{64}$/);
    const body = JSON.stringify({ symbol: "ADA-USD", side: "sell" });
    const h = signRequestHeaders("POST", "/v2/order", body, keys, 1_700_000_000_500);
    expect(h["X-API-Wallet-Timestamp"]).toBe("1699999999");
    const hash = createHash("sha256").update(body).digest("hex");
    const msg = `POST:/v2/order:${h["X-API-Wallet-Timestamp"]}:${h["X-API-Wallet-Nonce"]}:${hash}`;
    expect(verifyHex(msg, h["X-API-Wallet-Signature"], keys.publicKey)).toBe(true);

    const logon = signLogon(keys, 1_700_000_000_123);
    expect(verifyHex(`session.logon:1700000000123:${keys.publicKey}`, logon.signature, keys.publicKey)).toBe(true);
  });
});

describe("secrets and sessions", () => {
  it("encrypts API wallet keys with AES-256-GCM bound to their public key, and detects tampering", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/server/secrets");
    const blob = encryptSecret("deadbeef", "pub1");
    expect(blob.startsWith("v2.")).toBe(true);
    expect(blob).not.toContain("deadbeef");
    expect(decryptSecret(blob, "pub1")).toBe("deadbeef");
    // Copied onto another user's row (different public key): refused.
    expect(() => decryptSecret(blob, "pub2")).toThrow();
    const parts = blob.split(".");
    parts[3] = Buffer.from("x" + Buffer.from(parts[3], "base64url").toString("latin1"), "latin1").toString("base64url");
    expect(() => decryptSecret(parts.join("."), "pub1")).toThrow();
    // A truncated tag is refused rather than checked against fewer bytes.
    const short = blob.split(".");
    short[2] = Buffer.from(short[2], "base64url").subarray(0, 4).toString("base64url");
    expect(() => decryptSecret(short.join("."), "pub1")).toThrow();
  });

  it("still reads v1 secrets written before v2", async () => {
    const { createCipheriv, randomBytes } = await import("node:crypto");
    const { decryptSecret } = await import("@/lib/server/secrets");
    const key = Buffer.from("ab".repeat(32), "hex");
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([c.update("cafe", "utf8"), c.final()]);
    const v1 = ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
    expect(decryptSecret(v1, "anything")).toBe("cafe");
  });

  it("rejects forged or expired session cookies", async () => {
    const U1 = "d4c55f6c-e759-498c-a3e0-c1019528c119";
    const { encodeSession, decodeSession } = await import("@/lib/server/session");
    const tok = encodeSession({ uid: U1, addr: "addr1x", v: 1 }, 1_000_000);
    expect(decodeSession(tok, 1_000_000)).toMatchObject({ uid: U1, v: 1 });
    // Signed but not a user id (never issued by Locke): refused before it reaches the database.
    expect(decodeSession(encodeSession({ uid: "u1", addr: "a", v: 1 }))).toBeNull();
    const [payload, mac] = tok.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "u2", addr: "a", v: 1, exp: 9e9 })).toString("base64url");
    expect(decodeSession(`${forged}.${mac}`)).toBeNull();
    // Sessions last a day.
    expect(decodeSession(tok, 1_000_000 + 23 * 3600_000)).not.toBeNull();
    expect(decodeSession(`${payload}.${mac}`, 1_000_000 + 25 * 3600_000)).toBeNull();
    // Cookies from before versioning carry no version and no longer count.
    const { createHmac } = await import("node:crypto");
    const old = Buffer.from(JSON.stringify({ uid: U1, addr: "a", exp: 9e9 })).toString("base64url");
    const oldMac = createHmac("sha256", "s".repeat(40)).update(old).digest("base64url");
    expect(decodeSession(`${old}.${oldMac}`)).toBeNull();
  });
});

describe("post-login redirects", () => {
  it("allows same-site paths only", async () => {
    const { safeNext } = await import("@/lib/server/pageAuth");
    expect(safeNext("/plans/abc?x=1#y")).toBe("/plans/abc?x=1#y");
    expect(safeNext(["/account", "/x"])).toBe("/account");
    for (const bad of ["//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "https://evil.com", "evil.com", "/%0a/x\u0000", "", undefined]) {
      expect(safeNext(bad as string | undefined)).toBe("/portfolio");
    }
  });
});

describe("same-origin check", () => {
  it("refuses other origins and unparseable ones without throwing a 500", async () => {
    const { assertSameOrigin } = await import("@/lib/server/session");
    const req = (origin: string | null, host = "locke.example") =>
      new Request("https://locke.example/api/x", { method: "POST", headers: { host, ...(origin == null ? {} : { origin }) } });
    expect(() => assertSameOrigin(req("https://locke.example"))).not.toThrow();
    for (const o of ["https://evil.example", "null", "not a url", null]) {
      expect(() => assertSameOrigin(req(o))).toThrow(/Cross-origin/);
    }
    expect(() => assertSameOrigin(new Request("https://locke.example/api/x", { method: "GET" }))).not.toThrow();
  });

  it("compares the whole origin, needs https off localhost, and ignores X-Forwarded-Host", async () => {
    const { assertSameOrigin } = await import("@/lib/server/session");
    const req = (origin: string, headers: Record<string, string> = { host: "locke.example" }) =>
      new Request("https://locke.example/api/x", { method: "POST", headers: { ...headers, origin } });
    // Same host, wrong scheme or port.
    expect(() => assertSameOrigin(req("http://locke.example"))).toThrow(/Cross-origin/);
    expect(() => assertSameOrigin(req("https://locke.example:8443"))).toThrow(/Cross-origin/);
    // A spoofed X-Forwarded-Host no longer makes an attacker's origin "ours".
    expect(() => assertSameOrigin(req("https://evil.example", { host: "locke.example", "x-forwarded-host": "evil.example" }))).toThrow(/Cross-origin/);
    // Local development over http.
    expect(() => assertSameOrigin(req("http://localhost:3000", { host: "localhost:3000" }))).not.toThrow();
    expect(() => assertSameOrigin(req("http://127.0.0.1:3000", { host: "127.0.0.1:3000" }))).not.toThrow();
    expect(() => assertSameOrigin(req("http://localhost:3000", { host: "localhost:4000" }))).toThrow(/Cross-origin/);
    // The site URLs Netlify provides count even when Host is the internal one.
    const saved = { URL: process.env.URL, DEPLOY_URL: process.env.DEPLOY_URL };
    process.env.URL = "https://trylocke.online";
    process.env.DEPLOY_URL = "https://abc123--locke.netlify.app";
    try {
      expect(() => assertSameOrigin(req("https://trylocke.online", { host: "internal.netlify" }))).not.toThrow();
      expect(() => assertSameOrigin(req("https://abc123--locke.netlify.app", { host: "internal.netlify" }))).not.toThrow();
      expect(() => assertSameOrigin(req("http://trylocke.online", { host: "internal.netlify" }))).toThrow(/Cross-origin/);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe("Strike connect errors", () => {
  it("explains that a builder's own wallet can't connect through its code", async () => {
    const { verifyBuilderSignature } = await import("@/lib/strike/client");
    const real = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "cannot connect an account to its own builder code" }), { status: 400 })) as typeof fetch;
    try {
      await expect(verifyBuilderSignature({ nonce: "n", walletSignature: "a:b" })).rejects.toThrow(/registered Locke's builder code/);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("Strike price cache", () => {
  it("rides out a brief outage on the last mark, but never serves one minutes old as live", async () => {
    const { getMarkPrice } = await import("@/lib/strike/client");
    const real = globalThis.fetch;
    let up = true;
    globalThis.fetch = (async () =>
      up ? new Response(JSON.stringify({ p: "0.5", i: "0.5", r: "0.00001", T: 0 })) : new Response("down", { status: 503 })) as typeof fetch;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      expect((await getMarkPrice("STALE-USD")).mark).toBe(0.5);
      up = false;
      vi.setSystemTime(Date.now() + 10_000);
      expect((await getMarkPrice("STALE-USD")).mark).toBe(0.5); // a few seconds old: still served
      vi.setSystemTime(Date.now() + 5 * 60_000);
      await expect(getMarkPrice("STALE-USD")).rejects.toThrow(); // minutes old: refused, so views say "not live"
    } finally {
      vi.useRealTimers();
      globalThis.fetch = real;
    }
  });
});
