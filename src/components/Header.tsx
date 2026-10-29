"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LockeMark } from "./Logo";
import { useWallet } from "./WalletProvider";
import { shortAddr } from "@/lib/ui/format";

const pill = "inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-[14px] backdrop-blur-md transition-colors";
const quiet = "bg-[#e6e5e1]/95 text-ink shadow-[0_1px_0_rgb(0_0_0/0.04)] hover:bg-paper";

/**
 * Floating header: round mark on the left, separate pills in the middle, a coloured action
 * pill on the right. Below md the middle pills fold into a round menu button.
 */
export function Header() {
  const { me } = useWallet();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const trigger = menuButton.current;
    // Focus moves into the menu, Tab stays inside it, and Escape or closing returns focus to the button.
    dialog.current?.querySelector<HTMLElement>("button, a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setOpen(false);
      if (e.key !== "Tab" || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>("button, a[href]")];
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
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      trigger?.focus();
    };
  }, [open]);

  // Locke on Base is its own area with its own sign-in: its pages get its own links.
  const onBase = path === "/base" || path.startsWith("/base/");
  const links = onBase
    ? [
        { href: "/base", label: "Vaults" },
        { href: "/base/new", label: "New vault" },
      ]
    : me
    ? [
        { href: "/portfolio", label: "Portfolio" },
        { href: "/protect", label: "New plan" },
        { href: "/how-it-works", label: "How it works" },
      ]
    : [
        { href: "/how-it-works", label: "How it works" },
        { href: "/protect/holdings", label: "Holdings" },
        { href: "/protect/costs", label: "Operating costs" },
        { href: "/base", label: "Vaults on Base" },
      ];
  const isOn = (href: string) =>
    path === href || (href !== "/base" && path.startsWith(href + "/")) || (href === "/portfolio" && path.startsWith("/plans/")) || (href === "/base" && path.startsWith("/base/vaults/"));
  const cta = me ? { href: "/account", label: shortAddr(me.address) } : { href: "/connect", label: "Get started" };

  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-0 z-40">
        <div className="mx-auto flex h-16 items-center gap-2 px-3 sm:px-4">
          <Link href="/" aria-label="Locke home" className="pointer-events-auto flex shrink-0 items-center gap-2 rounded-full bg-paper/90 py-1 pl-1 pr-3.5 backdrop-blur-md">
            <LockeMark size={30} />
            <span className="text-[17px] font-medium tracking-[-0.03em]" style={{ fontFamily: "var(--font-display)" }}>
              Locke
            </span>
          </Link>

          <nav aria-label="Main" className="pointer-events-auto mx-auto hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <Link key={l.href} href={l.href} aria-current={isOn(l.href) ? "page" : undefined} className={`${pill} ${isOn(l.href) ? "bg-ink text-paper" : quiet}`}>
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="pointer-events-auto ml-auto flex items-center gap-1 md:ml-0">
            {/* On the sign-in page itself, "Get started" would only link back to it. */}
            {!onBase && (me || path !== "/connect") && (
              <Link
                href={cta.href}
                className={`${pill} ${me ? `num ${path === "/account" ? "bg-ink text-paper" : quiet}` : "bg-cobalt text-paper hover:bg-cobalt-deep"}`}
              >
                {cta.label}
              </Link>
            )}
            <button
              ref={menuButton}
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              aria-expanded={open}
              className="grid h-9 w-9 place-items-center rounded-full bg-paper/90 backdrop-blur-md md:hidden"
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
          <div ref={dialog} role="dialog" aria-modal="true" aria-label="Menu" className="m-2 animate-rise rounded-[28px] bg-paper p-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-1">
              <span className="flex items-center gap-2">
                <LockeMark size={30} />
                <span className="text-[17px] font-medium tracking-[-0.03em]" style={{ fontFamily: "var(--font-display)" }}>
                  Locke
                </span>
              </span>
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="grid h-10 w-10 place-items-center rounded-full bg-mist">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                  <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <nav aria-label="Menu" className="mt-6 flex flex-col px-3 pb-4">
              {[...links, ...(onBase ? [] : me ? [{ href: "/account", label: "Account" }, { href: "/withdraw", label: "Withdraw" }] : [])].map((l) => (
                <Link key={l.href} href={l.href} className={`display border-b border-line py-3 text-[26px] ${isOn(l.href) ? "text-ink" : "text-ink-2"}`}>
                  {l.label}
                </Link>
              ))}
            </nav>
            {!onBase && (me || path !== "/connect") && (
              <Link href={me ? "/protect" : "/connect"} className="mt-4 flex h-12 items-center justify-center rounded-full bg-cobalt text-[15px] text-paper">
                {me ? "New protection plan" : "Get started"}
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
