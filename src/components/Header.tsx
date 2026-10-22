"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useWallet } from "./WalletProvider";
import { shortAddr, usd } from "@/lib/ui/format";

export function Header() {
  const { me, signOut } = useWallet();
  const path = usePathname();
  const router = useRouter();
  const nav = (href: string, label: string) => (
    <Link
      href={href}
      className={`rounded px-2 py-1 text-sm ${path.startsWith(href) ? "text-text" : "text-muted hover:text-text"}`}
    >
      {label}
    </Link>
  );
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
        <Link href={me ? "/portfolio" : "/"} className="flex items-center gap-2">
          <LockeMark />
          <span className="num text-sm font-semibold tracking-[0.2em]">LOCKE</span>
        </Link>
        {me && (
          <nav className="ml-2 flex items-center gap-1">
            {nav("/portfolio", "Portfolio")}
            {nav("/protect", "New plan")}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-3">
          {me ? (
            <>
              {me.balance && (
                <span className="num hidden text-xs text-muted sm:inline" title="Available on Strike">
                  {usd(me.balance.available)} on Strike
                </span>
              )}
              <span className="num hidden rounded border border-line px-2 py-1 text-xs text-muted md:inline">{shortAddr(me.address)}</span>
              <button
                onClick={async () => {
                  await signOut();
                  router.push("/");
                }}
                className="text-xs text-muted hover:text-text"
              >
                Sign out
              </button>
            </>
          ) : (
            path !== "/" && (
              <Link href="/" className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-bg">
                Connect
              </Link>
            )
          )}
        </div>
      </div>
    </header>
  );
}

export function LockeMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="1.5" fill="none" stroke="var(--color-accent)" strokeWidth="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="var(--color-accent)" strokeWidth="2" />
      <path d="M12 14v3" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
