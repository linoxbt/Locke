import { describe, expect, it } from "vitest";
import { shortError } from "@/lib/server/errors";
import { readJson } from "@/lib/server/http";
import { ipBucket, rateLimit } from "@/lib/server/rateLimit";

describe("rate limiting", () => {
  it("buckets IPv4 by /24 and IPv6 by /48", () => {
    expect(ipBucket("203.0.113.77")).toBe("203.0.113.0/24");
    expect(ipBucket("::ffff:203.0.113.9")).toBe("203.0.113.0/24");
    expect(ipBucket("2001:db8:aa:bb:1:2:3:4")).toBe("2001:db8:aa::/48");
    expect(ipBucket("2001:db8:aa:bb::9")).toBe("2001:db8:aa::/48");
    expect(ipBucket("2001:0DB8:00aa:00bb:ffff::1")).toBe("2001:db8:aa::/48");
    expect(ipBucket("2001:db8::1")).toBe("2001:db8:0::/48");
    // Every /64 a site hands out is the same network: rotating through them buys no more sign-ins.
    expect(ipBucket("2001:db8:aa:1::1")).toBe(ipBucket("2001:db8:aa:ffff::1"));
    expect(ipBucket("2001:db8:ab::1")).not.toBe(ipBucket("2001:db8:aa::1"));
    expect(ipBucket("[2001:db8:aa::1]")).toBe("2001:db8:aa::/48");
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

describe("logged errors", () => {
  it("keep viem's short message and leave out the request, whose RPC URL can carry a key", () => {
    const viemish = Object.assign(new Error("HTTP request failed.\n\nURL: https://base-mainnet.example/v2/SECRETKEY\nRequest body: {}"), {
      shortMessage: "HTTP request failed.",
    });
    expect(shortError(viemish)).toBe("HTTP request failed.");
    expect(shortError(new Error("fetch to https://rpc.example/v2/SECRETKEY failed\nmore"))).toBe("fetch to [url] failed");
    expect(shortError("plain")).toBe("plain");
    expect(shortError(null)).toBe("null");
  });
});
