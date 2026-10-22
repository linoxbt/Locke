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
  it("encrypts API wallet keys with AES-256-GCM and detects tampering", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/server/secrets");
    const blob = encryptSecret("deadbeef");
    expect(blob).not.toContain("deadbeef");
    expect(decryptSecret(blob)).toBe("deadbeef");
    const parts = blob.split(".");
    parts[3] = Buffer.from("x" + Buffer.from(parts[3], "base64url").toString("latin1"), "latin1").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("rejects forged or expired session cookies", async () => {
    const { encodeSession, decodeSession } = await import("@/lib/server/session");
    const tok = encodeSession({ uid: "u1", addr: "addr1x" }, 1_000_000);
    expect(decodeSession(tok, 1_000_000)?.uid).toBe("u1");
    const [payload, mac] = tok.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "u2", addr: "a", exp: 9e9 })).toString("base64url");
    expect(decodeSession(`${forged}.${mac}`)).toBeNull();
    expect(decodeSession(`${payload}.${mac}`, 1_000_000 + 8 * 86400_000)).toBeNull();
  });
});
