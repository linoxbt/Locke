import { createHash, createPublicKey, verify } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
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
