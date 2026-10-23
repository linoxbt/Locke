import { redirect } from "next/navigation";
import { ConfigError } from "./config";
import { currentSession, type Session } from "./session";

/** Session for a server-rendered page, or null when signed out (or sessions aren't configured yet). */
export async function optionalSession(): Promise<Session | null> {
  try {
    return await currentSession();
  } catch (e) {
    if (e instanceof ConfigError) return null;
    throw e;
  }
}

/** Gate a page: signed-out visitors go to /connect and come back to `returnTo` afterwards. */
export async function requirePageSession(returnTo: string): Promise<Session> {
  const s = await optionalSession();
  if (!s) redirect(`/connect?next=${encodeURIComponent(returnTo)}`);
  return s;
}

/**
 * Only same-site relative paths are allowed as post-login destinations (no open redirects).
 * Browsers strip tabs and newlines from URLs and treat "\" like "/", so "/\t/evil.com" would
 * leave the site: anything with control characters or backslashes is refused, and the result
 * must resolve to our own origin.
 */
export function safeNext(next: string | string[] | undefined, fallback = "/portfolio"): string {
  const n = Array.isArray(next) ? next[0] : next;
  if (!n || n.length > 512 || !n.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(n)) return fallback;
  try {
    const base = "https://locke.invalid";
    const u = new URL(n, base);
    if (u.origin !== base || u.pathname.startsWith("//")) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
