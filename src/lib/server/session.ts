import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { config } from "./config";
import { db } from "./db";
import { HttpError } from "./errors";

const COOKIE = "locke_session";
const TTL_S = 24 * 3600;

export interface Session {
  uid: string;
  addr: string;
  /** users.session_version when the cookie was issued; signing out bumps it, which ends every cookie issued before. */
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

/** Signature and expiry only. currentSession also checks the version against the database. */
export function decodeSession(token: string | undefined, now = Date.now()): Session | null {
  if (!token || token.length > 2048) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const got = Buffer.from(mac);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    if (typeof s.uid !== "string" || !s.uid || typeof s.v !== "number" || typeof s.exp !== "number" || s.exp * 1000 < now) return null;
    return s;
  } catch {
    return null;
  }
}

const cookieFlags = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
});

export function setSessionCookie(res: NextResponse, s: Omit<Session, "exp">) {
  res.cookies.set(COOKIE, encodeSession(s), { ...cookieFlags(), maxAge: TTL_S });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(COOKIE, "", { ...cookieFlags(), maxAge: 0 });
}

/** The signed-in user, or null. A cookie from before the user last signed out no longer counts. */
export async function currentSession(): Promise<Session | null> {
  const s = decodeSession((await cookies()).get(COOKIE)?.value);
  if (!s) return null;
  const [u] = await db()`select session_version from users where id = ${s.uid}`;
  return u && Number(u.session_version) === s.v ? s : null;
}

/** Ends every session the user has open, on every device. */
export async function revokeSessions(uid: string) {
  await db()`update users set session_version = session_version + 1 where id = ${uid}`;
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** State-changing requests must come from our own origin (cookie is SameSite=Lax as well). */
export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = hostOf(req.headers.get("origin"));
  const allowed = new Set(
    [
      (req.headers.get("x-forwarded-host") ?? "").split(",")[0].trim(),
      req.headers.get("host"),
      hostOf(process.env.URL),
      hostOf(process.env.DEPLOY_PRIME_URL),
      hostOf(process.env.NEXT_PUBLIC_SITE_URL),
    ].filter(Boolean)
  );
  if (!origin || !allowed.has(origin)) throw new HttpError(403, "Cross-origin request refused");
}

export async function requireSession(req: Request): Promise<Session> {
  assertSameOrigin(req);
  const s = await currentSession();
  if (!s) throw new HttpError(401, "Your session ended. Sign in again.");
  return s;
}
