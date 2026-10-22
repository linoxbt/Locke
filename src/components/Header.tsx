"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useWallet } from "./WalletProvider";
import { shortAddr } from "@/lib/ui/format";

const pill = "inline-flex h-10 shrink-0 items-center rounded-full px-4 text-[15px] backdrop-blur-md transition-colors";
const quiet = "bg-[#e6e5e1]/95 text-ink shadow-[0_1px_0_rgb(0_0_0/0.04)] hover:bg-paper";

/**
 * Floating header: round mark on the left, separate pills in the middle, a coloured action
 * pill on the right. Below md the middle pills fold into a round menu button.
 */
export function Header() {
  const { me } = useWallet();
  const path = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const links = me
    ? [
        { href: "/portfolio", label: "Portfolio" },
        { href: "/protect", label: "New plan" },
        { href: "/how-it-works", label: "How it works" },
      ]
    : [
        { href: "/how-it-works", label: "How it works" },
        { href: "/protect/holdings", label: "Holdings" },
        { href: "/protect/costs", label: "Operating costs" },
      ];
  const isOn = (href: string) => path === href || path.startsWith(href + "/") || (href === "/portfolio" && path.startsWith("/plans/"));
  const cta = me ? { href: "/account", label: shortAddr(me.address) } : { href: "/connect", label: "Get started" };

  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-0 z-40">
        <div className="mx-auto flex h-[72px] items-center gap-2 px-3 sm:px-4">
          <Link href="/" aria-label="Locke home" className="pointer-events-auto shrink-0">
            <LockeMark />
          </Link>

          <nav aria-label="Main" className="pointer-events-auto mx-auto hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <Link key={l.href} href={l.href} aria-current={isOn(l.href) ? "page" : undefined} className={`${pill} ${isOn(l.href) ? "bg-ink text-paper" : quiet}`}>
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="pointer-events-auto ml-auto flex items-center gap-1 md:ml-0">
            {!me && path !== "/connect" && (
              <Link href="/connect" className={`${pill} ${quiet} hidden sm:inline-flex`}>
                Connect
              </Link>
            )}
            <Link
              href={cta.href}
              className={`${pill} ${me ? `num ${path === "/account" ? "bg-ink text-paper" : quiet}` : "bg-cobalt text-paper hover:bg-cobalt-deep"}`}
            >
              {cta.label}
            </Link>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              aria-expanded={open}
              className="grid h-10 w-10 place-items-center rounded-full bg-paper/90 backdrop-blur-md md:hidden"
            >
              <svg width="16" height="4" viewBox="0 0 16 4" aria-hidden>
                <circle cx="2" cy="2" r="1.6" fill="currentColor" />
                <circle cx="8" cy="2" r="1.6" fill="currentColor" />
                <circle cx="14" cy="2" r="1.6" fill="currentColor" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm md:hidden" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Menu" className="m-2 animate-rise rounded-[28px] bg-paper p-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-1">
              <LockeMark />
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="grid h-10 w-10 place-items-center rounded-full bg-mist">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                  <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <nav aria-label="Menu" className="mt-6 flex flex-col px-3 pb-4">
              {[...links, ...(me ? [{ href: "/account", label: "Account" }, { href: "/withdraw", label: "Withdraw" }] : [{ href: "/connect", label: "Connect a wallet" }])].map((l) => (
                <Link key={l.href} href={l.href} className={`display border-b border-line py-3 text-[34px] ${isOn(l.href) ? "text-ink" : "text-ink-2"}`}>
                  {l.label}
                </Link>
              ))}
            </nav>
            <Link href={me ? "/protect" : "/connect"} className="flex h-16 items-center justify-center rounded-full bg-cobalt text-lg text-paper">
              {me ? "New protection plan" : "Get started"}
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

export function LockeMark({ size = 40 }: { size?: number }) {
  return (
    <span className="grid place-items-center rounded-full bg-ink text-paper" style={{ width: size, height: size }} aria-hidden>
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 20 20">
        <rect x="3.5" y="9" width="13" height="8.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="10" cy="13.2" r="1.3" fill="var(--color-lime)" />
      </svg>
    </span>
  );
}
