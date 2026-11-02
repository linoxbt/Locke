import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { HttpError } from "./errors";

const TTL_S = 24 * 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Session {
  uid: string;
  addr: string;
  /** base_users.session_version when the cookie was issued; signing out bumps it, which ends every cookie issued before. */
  v: number;
  exp: number;
}

function sign(payload: string): string {
  return createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
}

export function encodeSession(s: Omit<Session, "exp">, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...s, exp: Math.floor(now / 1000) + TTL_S })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Signature and expiry only. currentBaseSession also checks the version against the database. */
export function decodeSession(token: string | undefined, now = Date.now()): Session | null {
  if (!token || token.length > 2048) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const got = Buffer.from(mac);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    if (typeof s.uid !== "string" || !UUID.test(s.uid) || typeof s.v !== "number" || typeof s.exp !== "number" || s.exp * 1000 < now) return null;
    return s;
  } catch {
    return null;
  }
}

function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const o = new URL(url).origin;
    return o === "null" ? null : o;
  } catch {
    return null;
  }
}

const isLocalHost = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);

/**
 * State-changing requests must come from our own origin (cookie is SameSite=Lax as well). The
 * whole origin is compared, scheme included, and only https counts outside localhost. Allowed:
 * the site URLs Netlify and our env name, and https://<Host> (Netlify sets Host to the public
 * host). X-Forwarded-Host is client-controllable and ignored.
 */
export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = originOf(req.headers.get("origin"));
  const host = req.headers.get("host");
  const allowed = new Set(
    [
      originOf(process.env.URL),
      originOf(process.env.DEPLOY_PRIME_URL),
      originOf(process.env.DEPLOY_URL),
      originOf(process.env.NEXT_PUBLIC_SITE_URL),
      host ? originOf(`https://${host}`) : null,
      host && isLocalHost(host) ? originOf(`http://${host}`) : null,
    ].filter((o): o is string => !!o && (o.startsWith("https://") || isLocalHost(new URL(o).host)))
  );
  if (!origin || !allowed.has(origin)) throw new HttpError(403, "Cross-origin request refused");
}
