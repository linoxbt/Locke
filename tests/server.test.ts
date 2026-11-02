import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.SESSION_SECRET = "s".repeat(40);
});

describe("sessions", () => {
  it("rejects forged or expired session cookies", async () => {
    const U1 = "d4c55f6c-e759-498c-a3e0-c1019528c119";
    const { encodeSession, decodeSession } = await import("@/lib/server/session");
    const tok = encodeSession({ uid: U1, addr: "0xabc", v: 1 }, 1_000_000);
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
    expect(safeNext("/plans/0xabc?x=1#y")).toBe("/plans/0xabc?x=1#y");
    expect(safeNext(["/plans/new", "/x"])).toBe("/plans/new");
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
