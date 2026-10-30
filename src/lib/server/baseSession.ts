import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { db } from "./db";
import { HttpError } from "./errors";
import { assertSameOrigin, decodeSession, encodeSession, type Session } from "./session";

/**
 * Locke on Base signs in with an EVM wallet and keeps its own session, separate from the Strike
 * one: same signed format and lifetime, its own cookie and its own users table.
 */
const secureCookie = () => process.env.NODE_ENV !== "development";
const cookieName = () => (secureCookie() ? "__Host-locke_base" : "locke_base");
const TTL_S = 24 * 3600;
const flags = () => ({ httpOnly: true, secure: secureCookie(), sameSite: "lax" as const, path: "/" });

export function setBaseSessionCookie(res: NextResponse, s: Omit<Session, "exp">) {
  res.cookies.set(cookieName(), encodeSession(s), { ...flags(), maxAge: TTL_S });
}

export function clearBaseSessionCookie(res: NextResponse) {
  res.cookies.set(cookieName(), "", { ...flags(), maxAge: 0 });
}

/**
 * The Base session's address for display (the header), from the cookie's signature and expiry
 * alone: no database read on every page. Anything that acts uses currentBaseSession.
 */
export async function baseSessionHint(): Promise<string | null> {
  return decodeSession((await cookies()).get(cookieName())?.value)?.addr ?? null;
}

/** The signed-in Base user, or null. Signing out bumps the version and ends every older cookie. */
export async function currentBaseSession(): Promise<Session | null> {
  const s = decodeSession((await cookies()).get(cookieName())?.value);
  if (!s) return null;
  const [u] = await db()`select session_version from base_users where id = ${s.uid}`;
  return u && Number(u.session_version) === s.v ? s : null;
}

export async function requireBaseSession(req: Request): Promise<Session> {
  assertSameOrigin(req);
  const s = await currentBaseSession();
  if (!s) throw new HttpError(401, "Your session ended. Sign in again.");
  return s;
}

/** Find or create the user for a verified address (lower-case hex). */
export async function signInBaseUser(address: string): Promise<{ id: string; address: string; session_version: number }> {
  const [u] = await db()`
    insert into base_users (address) values (${address})
    on conflict (address) do update set address = excluded.address
    returning id, address, session_version`;
  return { id: u.id, address: u.address, session_version: Number(u.session_version) };
}

export async function revokeBaseSessions(uid: string) {
  await db()`update base_users set session_version = session_version + 1 where id = ${uid}`;
}
