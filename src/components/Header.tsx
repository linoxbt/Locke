"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "./WalletProvider";
import { shortAddr, usd } from "@/lib/ui/format";

const pill = "inline-flex h-10 shrink-0 items-center rounded-full px-4 text-[14px] transition";

export function Header() {
  const { me } = useWallet();
  const path = usePathname();
  const nav = (href: string, label: string) => {
    const on = path === href || (href !== "/" && path.startsWith(href + "/")) || (href === "/portfolio" && path.startsWith("/plans/"));
    return (
      <Link key={href} href={href} aria-current={on ? "page" : undefined} className={`${pill} ${on ? "bg-ink text-paper" : "bg-paper/90 text-ink hover:bg-paper"}`}>
        {label}
      </Link>
    );
  };
  return (
    <header className="fixed inset-x-0 top-0 z-40">
      <div className="mx-auto flex h-[72px] max-w-[1240px] items-center gap-2 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Locke home">
          <LockeMark />
          <span className="display hidden text-[22px] sm:inline">Locke</span>
        </Link>

        <nav className="mx-auto flex min-w-0 items-center gap-1 overflow-x-auto rounded-full bg-mist/70 p-1 backdrop-blur-md" aria-label="Main">
          {me ? (
            <>
              {nav("/portfolio", "Portfolio")}
              {nav("/protect", "New plan")}
              <span className="hidden sm:contents">{nav("/how-it-works", "How it works")}</span>
            </>
          ) : (
            nav("/how-it-works", "How it works")
          )}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5">
          {me ? (
            <Link
              href="/account"
              aria-current={path === "/account" ? "page" : undefined}
              className={`${pill} num ${path === "/account" ? "bg-ink text-paper" : "bg-paper/90 text-ink-2 hover:text-ink"}`}
              title="Account"
            >
              {me.balance && <span className="mr-3 hidden text-ink-3 lg:inline">{usd(me.balance.available)}</span>}
              <span className="hidden md:inline">{shortAddr(me.address)}</span>
              <span className="md:hidden">Account</span>
            </Link>
          ) : (
            path !== "/connect" && (
              <Link href="/connect" className={`${pill} bg-cobalt text-paper hover:bg-cobalt-deep`}>
                Connect
              </Link>
            )
          )}
        </div>
      </div>
    </header>
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
