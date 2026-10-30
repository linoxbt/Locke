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
  // Reopened from "Cookie settings" (a choice already exists): Escape closes it, and focus goes back.
  const opener = useRef<HTMLElement | null>(null);
  const [reopened, setReopened] = useState(false);

  useEffect(() => {
    if (!currentConsent()) setOpen(true);
    const reopen = () => {
      opener.current = document.activeElement as HTMLElement | null;
      setPreferences(currentConsent()?.preferences ?? false);
      setCustomize(true);
      setReopened(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_COOKIE_SETTINGS, reopen);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS, reopen);
  }, []);

  const docked = path.startsWith("/legal");

  useEffect(() => {
    if (!open) return;
    // Focus the notice itself, so neither choice looks preselected.
    card.current?.focus({ preventScroll: true });
    if (docked) return;
    // Modal: Tab stays inside the notice until a choice is made.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && reopened) return close();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, docked, customize, reopened]);

  if (!open) return null;

  function close() {
    setOpen(false);
    setCustomize(false);
    setReopened(false);
    opener.current?.focus();
    opener.current = null;
  }

  const choose = (prefs: boolean) => {
    saveConsent(prefs);
    close();
  };

  const button = "h-11 flex-1 rounded-full bg-cobalt px-5 text-[14px] font-medium text-paper transition hover:bg-cobalt-deep active:scale-[0.98] sm:flex-none sm:min-w-[120px]";
  const policy = (
    <Link href="/legal/cookies" className="text-cobalt underline underline-offset-2 hover:text-cobalt-deep">
      Cookie Policy
    </Link>
  );

  return (
    <div
      className={docked ? "pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center p-3 sm:p-5" : "fixed inset-0 z-[60] flex items-end justify-center bg-ink/45 p-3 backdrop-blur-[2px] sm:p-6"}
    >
      <div
        ref={card}
        role="dialog"
        tabIndex={-1}
        aria-modal={docked ? undefined : true}
        aria-labelledby={titleId}
        className={`pointer-events-auto w-full animate-rise rounded-[24px] bg-white p-5 text-ink outline-none shadow-[0_24px_60px_-20px_rgb(0_0_0/0.45)] sm:p-6 ${customize ? "max-w-[560px]" : "max-w-[920px]"}`}
      >
        {!customize ? (
          <>
            <h2 id={titleId} className="sr-only">
              Cookies on Locke
            </h2>
            {/* Stacked on phones; one row (text, then the choices) from sm up. */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
              <p className="text-[13px] leading-relaxed sm:flex-1">
                Locke uses cookies to keep you signed in. With your OK, it also remembers your wallet for next time. No analytics, no ads.
                See the {policy}.
              </p>
              <div className="flex shrink-0 flex-col gap-3 sm:items-end">
                <div className="flex gap-2">
                  <button type="button" onClick={() => choose(false)} className={button}>
                    Reject
                  </button>
                  <button type="button" onClick={() => choose(true)} className={button}>
                    Accept
                  </button>
                </div>
                <button type="button" onClick={() => setCustomize(true)} className="text-[13px] font-medium underline underline-offset-4 hover:text-cobalt">
                  Customize cookies
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <h2 id={titleId} className="display text-[20px]">
              Cookie settings
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
              Choose what Locke may keep in your browser. You can change this any time from Cookie settings at the bottom of the site. Details
              are in the {policy}.
            </p>
            <ul className="mt-4 divide-y divide-line rounded-2xl bg-mist">
              <li className="flex items-start justify-between gap-4 p-4">
                <div>
                  <div className="text-[14px] font-medium">Strictly necessary</div>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-2">
                    Keep you signed in, finish a deposit you started, send transactions from the wallet you signed in with, and remember
                    this choice. The app can&apos;t work without them.
                  </p>
                </div>
                <span className="mt-0.5 shrink-0 rounded-full bg-paper px-3 py-1 text-[12px] text-ink-2">Always on</span>
              </li>
              <li className="flex items-start justify-between gap-4 p-4">
                <div>
                  <label htmlFor="consent-preferences" className="text-[14px] font-medium">
                    Preferences
                  </label>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-2">Remember which wallet you used, so it reconnects on your next visit.</p>
                </div>
                <Toggle id="consent-preferences" checked={preferences} onChange={setPreferences} />
              </li>
              <li className="flex items-start justify-between gap-4 p-4">
                <div>
                  <div className="text-[14px] font-medium">Analytics and advertising</div>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-2">Locke uses none.</p>
                </div>
                <span className="mt-0.5 shrink-0 rounded-full bg-paper px-3 py-1 text-[12px] text-ink-3">Not used</span>
              </li>
            </ul>
            <div className="mt-5 flex gap-2 sm:justify-end">
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
