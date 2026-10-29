"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { currentConsent, OPEN_COOKIE_SETTINGS, saveConsent } from "@/lib/consent";

/**
 * Cookie notice. Shown until the visitor chooses; "Reject" and "Accept" carry equal weight, and
 * "Customize cookies" opens the categories. Reopened from the footer's "Cookie settings". On the
 * legal pages it docks at the bottom without dimming the page, so the policies stay readable.
 */
export function CookieConsent() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [customize, setCustomize] = useState(false);
  const [preferences, setPreferences] = useState(false);
  const titleId = useId();
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!currentConsent()) setOpen(true);
    const reopen = () => {
      setPreferences(currentConsent()?.preferences ?? false);
      setCustomize(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_COOKIE_SETTINGS, reopen);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS, reopen);
  }, []);

  const docked = path.startsWith("/legal");

  useEffect(() => {
    if (!open) return;
    card.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    if (docked) return;
    // Modal: Tab stays inside the notice until a choice is made.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && customize) return setCustomize(false);
      if (e.key !== "Tab" || !card.current) return;
      const items = [...card.current.querySelectorAll<HTMLElement>("button, a[href], input")];
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, docked, customize]);

  if (!open) return null;

  const choose = (prefs: boolean) => {
    saveConsent(prefs);
    setOpen(false);
    setCustomize(false);
  };

  const button = "h-12 flex-1 rounded-full bg-cobalt px-5 text-[16px] font-medium text-paper transition hover:bg-cobalt-deep active:scale-[0.98]";
  const policy = (
    <Link href="/legal/cookies" className="text-cobalt underline underline-offset-2 hover:text-cobalt-deep">
      Cookie Policy
    </Link>
  );

  return (
    <div
      className={docked ? "pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center p-3 sm:p-5" : "fixed inset-0 z-[60] flex items-end justify-center bg-ink/45 p-3 backdrop-blur-[2px] sm:items-center sm:p-6"}
    >
      <div
        ref={card}
        role="dialog"
        aria-modal={docked ? undefined : true}
        aria-labelledby={titleId}
        className="pointer-events-auto w-full max-w-[560px] animate-rise rounded-[28px] bg-white p-6 text-ink shadow-[0_24px_60px_-20px_rgb(0_0_0/0.45)] sm:p-8"
      >
        {!customize ? (
          <>
            <h2 id={titleId} className="sr-only">
              Cookies on Locke
            </h2>
            <p className="text-[15px] leading-[1.65] sm:text-[16px]">
              Locke uses cookies to keep you signed in and to make the app work. With your OK, it also remembers which wallet you used, so it
              reconnects next time. No analytics, no advertising. For more about the cookies and storage Locke uses, read the {policy}. To
              choose what Locke keeps, click Customize cookies.
            </p>
            <div className="mt-6 text-center">
              <button type="button" onClick={() => setCustomize(true)} className="text-[16px] font-medium underline underline-offset-4 hover:text-cobalt">
                Customize cookies
              </button>
            </div>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => choose(false)} className={button}>
                Reject
              </button>
              <button type="button" onClick={() => choose(true)} className={button}>
                Accept
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id={titleId} className="display text-[22px]">
              Cookie settings
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
              Choose what Locke may keep in your browser. You can change this any time from Cookie settings at the bottom of the site. Details
              are in the {policy}.
            </p>
            <ul className="mt-5 divide-y divide-line rounded-2xl bg-mist">
              <li className="flex items-start justify-between gap-4 p-4">
                <div>
                  <div className="text-[15px] font-medium">Strictly necessary</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                    Keep you signed in, finish a deposit you started, send transactions from the wallet you signed in with, and remember
                    this choice. The app can&apos;t work without them.
                  </p>
                </div>
                <span className="mt-0.5 shrink-0 rounded-full bg-paper px-3 py-1 text-[12px] text-ink-2">Always on</span>
              </li>
              <li className="flex items-start justify-between gap-4 p-4">
                <div>
                  <label htmlFor="consent-preferences" className="text-[15px] font-medium">
                    Preferences
                  </label>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-2">Remember which wallet you used, so it reconnects on your next visit.</p>
                </div>
                <Toggle id="consent-preferences" checked={preferences} onChange={setPreferences} />
              </li>
              <li className="flex items-start justify-between gap-4 p-4">
                <div>
                  <div className="text-[15px] font-medium">Analytics and advertising</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-2">Locke uses none.</p>
                </div>
                <span className="mt-0.5 shrink-0 rounded-full bg-paper px-3 py-1 text-[12px] text-ink-3">Not used</span>
              </li>
            </ul>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => choose(preferences)} className={button}>
                Save choices
              </button>
              <button type="button" onClick={() => choose(true)} className={button}>
                Accept all
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Toggle({ id, checked, onChange }: { id: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? "bg-cobalt" : "bg-ink-3/40"}`}
    >
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-[left] ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

/** The footer link that reopens the settings. */
export function CookieSettingsLink({ className = "" }: { className?: string }) {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS))} className={className}>
      Cookie settings
    </button>
  );
}
