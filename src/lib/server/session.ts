import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { config } from "./config";
import { HttpError } from "./errors";

const COOKIE = "locke_session";
const TTL_S = 7 * 24 * 3600;

export interface Session {
  uid: string;
  addr: string;
  exp: number;
}

function sign(payload: string): string {
  return createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
}

export function encodeSession(s: Omit<Session, "exp">, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...s, exp: Math.floor(now / 1000) + TTL_S })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(token: string | undefined, now = Date.now()): Session | null {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const got = Buffer.from(mac);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    if (!s.uid || s.exp * 1000 < now) return null;
    return s;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: NextResponse, s: Omit<Session, "exp">) {
  res.cookies.set(COOKIE, encodeSession(s), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_S,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function currentSession(): Promise<Session | null> {
  return decodeSession((await cookies()).get(COOKIE)?.value);
}

/** State-changing requests must come from our own origin (cookie is SameSite=Lax as well). */
export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) throw new HttpError(403, "Cross-origin request refused");
}

export async function requireSession(req: Request): Promise<Session> {
  assertSameOrigin(req);
  const s = await currentSession();
  if (!s) throw new HttpError(401, "Connect your wallet first");
  return s;
}
