import { describe, expect, it } from "vitest";
import { cborDecode, cborEncode, type CborKey, type CborValue } from "@/lib/cardano/cose";
import { parseStrikeExpiry, walletSignatureProblem } from "@/lib/server/connect";
import { readJson, strikeErrorText } from "@/lib/server/http";
import { ipBucket, rateLimit } from "@/lib/server/rateLimit";
import { StrikeError } from "@/lib/strike/client";
import { addressBytes, bech, signData, walletKey } from "./helpers/cip30";

describe("CIP-30 sign-in signature (checked locally before Strike)", () => {
  const message = "Strike Finance builder connect\nnonce: 4f2a\nfee: 10 bps";
  const alice = walletKey();
  const bob = walletKey();
  const aliceAddr = addressBytes(alice.pub);
  const bobAddr = addressBytes(bob.pub);

  it("accepts the wallet that owns the address signing the exact challenge", () => {
    expect(walletSignatureProblem({ signature: signData(alice, aliceAddr, message), address: bech(aliceAddr), message })).toBeNull();
    // Hashed payload (blake2b-224 of the message), tag 18, enterprise address: all valid.
    expect(walletSignatureProblem({ signature: signData(alice, aliceAddr, message, { hashed: true }), address: bech(aliceAddr), message })).toBeNull();
    expect(walletSignatureProblem({ signature: signData(alice, aliceAddr, message, { tag18: true }), address: bech(aliceAddr), message })).toBeNull();
    const ent = addressBytes(alice.pub, { header: 0x61 });
    expect(walletSignatureProblem({ signature: signData(alice, ent, message), address: bech(ent), message })).toBeNull();
  });

  it("refuses a signature for another address, payload, key, or a tampered one", () => {
    const check = (signature: string, address = bech(aliceAddr), msg = message) => walletSignatureProblem({ signature, address, message: msg });
    // Bob signs honestly for his own address, but the login is for Alice's.
    expect(check(signData(bob, bobAddr, message))).toMatch(/another address/);
    // Bob claims Alice's address in the header: his key doesn't hash to it.
    expect(check(signData(bob, aliceAddr, message))).toMatch(/key does not match/);
    // Same key, different address of the same wallet (other stake part): not the address logging in.
    expect(check(signData(alice, addressBytes(alice.pub, { stake: new Uint8Array(28).fill(9) }), message))).toMatch(/another address/);
    // Right wallet, wrong payload (an older challenge).
    expect(check(signData(alice, aliceAddr, "something else"))).toMatch(/payload/);
    expect(check(signData(alice, aliceAddr, message, { hashed: true }), bech(aliceAddr), message + "x")).toMatch(/payload/);
    // COSE_Key says Bob, address is Bob's, but Alice made the signature.
    expect(check(signData(alice, bobAddr, message, { keyPub: bob.pub }), bech(bobAddr))).toMatch(/does not verify/);
    // One flipped bit in the signature.
    const [cose, key] = signData(alice, aliceAddr, message).split(":");
    const tampered = cose.slice(0, -2) + (parseInt(cose.slice(-2), 16) ^ 1).toString(16).padStart(2, "0");
    expect(check(`${tampered}:${key}`)).toMatch(/does not verify/);
    // Script payment credential: there is no key to check.
    const script = addressBytes(alice.pub, { header: 0x11 });
    expect(check(signData(alice, script, message), bech(script))).toMatch(/no payment key/);
    // Garbage never throws.
    expect(check("00:00")).toMatch(/unreadable/);
    expect(check("zz")).toMatch(/unreadable/);
  });

  it("encodes and decodes the CBOR it needs, strictly", () => {
    const v = new Map<CborKey, CborValue>([[1, -8], ["address", new Uint8Array([1, 2])], [-2, [true, null, "x"]]]);
    expect(cborDecode(cborEncode(v))).toEqual(v);
    expect(() => cborDecode(Uint8Array.of(0x01, 0x02))).toThrow(/trailing/);
    expect(() => cborDecode(Uint8Array.of(0x5a, 0xff, 0xff, 0xff, 0xff))).toThrow();
    expect(() => cborDecode(Uint8Array.of(0xa2, 0x01, 0x01, 0x01, 0x02))).toThrow(/duplicate/);
  });
});

describe("Strike API wallet expiry", () => {
  it("reads ISO date-times and epoch seconds or milliseconds; year 9999 means never", () => {
    expect(parseStrikeExpiry("9999-12-31T23:59:59Z")).toBeNull();
    expect(parseStrikeExpiry("2027-01-02T03:04:05Z")?.toISOString()).toBe("2027-01-02T03:04:05.000Z");
    expect(parseStrikeExpiry(1_800_000_000)?.getTime()).toBe(1_800_000_000_000);
    expect(parseStrikeExpiry("1800000000000")?.getTime()).toBe(1_800_000_000_000);
    expect(parseStrikeExpiry(253402300799)).toBeNull(); // 9999-12-31 in seconds
    for (const v of [undefined, null, "", "soon", {}]) expect(parseStrikeExpiry(v)).toBeNull();
  });
});

describe("rate limiting", () => {
  it("buckets IPv4 by /24 and IPv6 by /64", () => {
    expect(ipBucket("203.0.113.77")).toBe("203.0.113.0/24");
    expect(ipBucket("::ffff:203.0.113.9")).toBe("203.0.113.0/24");
    expect(ipBucket("2001:db8:aa:bb:1:2:3:4")).toBe("2001:db8:aa:bb::/64");
    expect(ipBucket("2001:db8:aa:bb::9")).toBe("2001:db8:aa:bb::/64");
    expect(ipBucket("2001:0DB8:00aa:00bb:ffff::1")).toBe("2001:db8:aa:bb::/64");
    expect(ipBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
    for (const bad of [null, "", "999.1.1.1", "1::2::3", "nonsense", "1:2:3:4:5:6:7:8:9"]) expect(ipBucket(bad)).toBeNull();
  });

  it("allows a burst, then 429s until tokens refill", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) rateLimit("u1:test", 3, t);
    expect(() => rateLimit("u1:test", 3, t)).toThrow(/a little fast/);
    rateLimit("u2:test", 3, t); // other users unaffected
    rateLimit("u1:test", 3, t + 20_000); // one token back after 20 s at 3/min
    expect(() => rateLimit("u1:test", 3, t + 20_000)).toThrow();
  });
});

describe("error text shown to users", () => {
  it("keeps short sentences from Strike's error body only", () => {
    expect(strikeErrorText(new StrikeError("insufficient balance", 400, { error: "insufficient balance" }))).toBe("Strike: insufficient balance");
    // Our own fallback names the endpoint: not shown.
    expect(strikeErrorText(new StrikeError("POST /v2/order failed (400)", 400, "<html>"))).toBe("Strike refused the request.");
    expect(strikeErrorText(new StrikeError("x".repeat(161), 400, { error: "x".repeat(161) }))).toBe("Strike refused the request.");
    const json = '{"detail":[{"loc":["body"]}]}';
    expect(strikeErrorText(new StrikeError(json, 422, { message: json }))).toBe("Strike refused the request.");
    const stack = "TypeError: x is undefined\n    at foo (/app/server.js:1:2)";
    expect(strikeErrorText(new StrikeError(stack, 400, { error: stack }))).toBe("Strike refused the request.");
    expect(strikeErrorText(new StrikeError("Strike didn't answer in time", 504, null))).toBe("Strike didn't answer in time");
    expect(strikeErrorText(new StrikeError("GET /v2/account failed (500)", 500, {}))).toMatch(/unavailable/);
  });
});

describe("request bodies", () => {
  it("stops reading a chunked body past the limit", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(64 * 1024).fill(0x20);
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        if (pulled > 100) c.close();
        else c.enqueue(chunk);
      },
    });
    const req = new Request("https://x.test/api", { method: "POST", body, duplex: "half" } as RequestInit);
    await expect(readJson(req)).rejects.toThrow(/too large/);
    expect(pulled).toBeLessThan(10);
  });

  it("parses a normal JSON object and refuses other shapes", async () => {
    const post = (body: string) => new Request("https://x.test/api", { method: "POST", body });
    expect(await readJson(post('{"a":1}'))).toEqual({ a: 1 });
    await expect(readJson(post("[1]"))).rejects.toThrow(/JSON object/);
    await expect(readJson(new Request("https://x.test/api", { method: "POST" }))).rejects.toThrow(/JSON object/);
  });
});
