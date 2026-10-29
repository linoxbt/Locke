// Cookie consent. Locke uses no analytics or advertising cookies; the one optional kind of
// storage is "preferences" (remembering which wallet you used last). Strictly necessary storage
// (sign-in sessions, a deposit waiting to be confirmed, this choice itself) needs no consent.
//
// The choice is kept in a first-party cookie for 12 months: locke_consent=v1.p1.<unix seconds>.

export const CONSENT_COOKIE = "locke_consent";
export const CONSENT_MAX_AGE_S = 365 * 24 * 3600;
const VERSION = "v1";

export interface Consent {
  preferences: boolean;
  /** When the choice was made (unix seconds). */
  at: number;
}

/** Read a consent cookie value; null when absent, malformed or from an older version of the banner. */
export function parseConsent(value: string | undefined | null): Consent | null {
  const m = /^v1\.p([01])\.(\d{9,11})$/.exec(value ?? "");
  return m ? { preferences: m[1] === "1", at: Number(m[2]) } : null;
}

export function serializeConsent(c: Consent): string {
  return `${VERSION}.p${c.preferences ? 1 : 0}.${Math.floor(c.at)}`;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const hit = document.cookie.split("; ").find((p) => p.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

export function currentConsent(): Consent | null {
  return parseConsent(readCookie(CONSENT_COOKIE));
}

/** Preference storage is allowed only after the visitor said yes to it. */
export function allowPreferences(): boolean {
  return currentConsent()?.preferences === true;
}

/** Keys of the optional preference storage; cleared when the visitor declines it. */
export const PREFERENCE_KEYS = ["locke.wallet", "locke.base.wallet"];

export const CONSENT_CHANGED = "locke:consent-changed";
export const OPEN_COOKIE_SETTINGS = "locke:open-cookie-settings";

export function saveConsent(preferences: boolean) {
  const c: Consent = { preferences, at: Date.now() / 1000 };
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${serializeConsent(c)}; Max-Age=${CONSENT_MAX_AGE_S}; Path=/; SameSite=Lax${secure}`;
  if (!preferences) {
    for (const k of PREFERENCE_KEYS) {
      try {
        localStorage.removeItem(k);
      } catch {
        /* storage unavailable: nothing was kept */
      }
    }
  }
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGED, { detail: c }));
}

/** Reopen the cookie settings from anywhere (the footer's "Cookie settings" link). */
export function openCookieSettings() {
  window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS));
}
