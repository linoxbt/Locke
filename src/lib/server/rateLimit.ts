import { HttpError } from "./errors";

/**
 * The network a client IP belongs to, for rate limiting: IPv4 /24, IPv6 /64 (one home or
 * phone gets a whole /64, so per-address limits on IPv6 are trivially dodged). null if unparseable.
 */
export function ipBucket(ip: string | null): string | null {
  if (!ip) return null;
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(ip.trim());
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    return `${o[0]}.${o[1]}.${o[2]}.0/24`;
  }
  const s = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (!/^[0-9a-f:]+$/.test(s) || !s.includes(":")) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 2 && missing < 1) || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...right];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

const buckets = new Map<string, { tokens: number; at: number; cap: number }>();
const MAX_KEYS = 10_000;

/**
 * Token bucket per key (user id + route), kept in this function instance's memory: a cheap
 * brake on scripted calls that fan out to Strike or Koios, not a global quota.
 */
export function rateLimit(key: string, perMinute: number, now = Date.now()) {
  const rate = perMinute / 60_000;
  const b = buckets.get(key);
  const tokens = b ? Math.min(perMinute, b.tokens + (now - b.at) * rate) : perMinute;
  if (tokens < 1) {
    buckets.set(key, { tokens, at: now, cap: perMinute });
    throw new HttpError(429, "You're going a little fast. Wait a moment and try again.");
  }
  if (!b && buckets.size >= MAX_KEYS) {
    // Drop buckets that have refilled completely; they'd start full anyway.
    for (const [k, v] of buckets) if (v.tokens + ((now - v.at) * v.cap) / 60_000 >= v.cap) buckets.delete(k);
    if (buckets.size >= MAX_KEYS) buckets.clear();
  }
  buckets.set(key, { tokens: tokens - 1, at: now, cap: perMinute });
}

/** Per-route budgets (calls per minute per user). */
export const LIMITS = {
  strikeWrite: 10,
  sync: 30,
  read: 30,
  ack: 60,
} as const;
