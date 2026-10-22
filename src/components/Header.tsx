"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useWallet } from "./WalletProvider";
import { shortAddr, usd } from "@/lib/ui/format";

const pill = "inline-flex h-10 items-center rounded-full px-4 text-[14px] transition";

export function Header() {
  const { me, signOut } = useWallet();
  const path = usePathname();
  const router = useRouter();
  const nav = (href: string, label: string) => {
    const on = path === href || (href !== "/" && path.startsWith(href));
    return (
      <Link key={href} href={href} aria-current={on ? "page" : undefined} className={`${pill} ${on ? "bg-ink text-paper" : "bg-paper/90 text-ink hover:bg-paper"}`}>
        {label}
      </Link>
    );
  };
  return (
    <header className="fixed inset-x-0 top-0 z-40">
      <div className="mx-auto flex h-[72px] max-w-[1240px] items-center gap-2 px-4 sm:px-6">
        <Link href={me ? "/portfolio" : "/"} className="flex items-center gap-2.5" aria-label="Locke home">
          <LockeMark />
          <span className="display hidden text-[22px] sm:inline">Locke</span>
        </Link>

        {me && (
          <nav className="mx-auto flex items-center gap-1 rounded-full bg-mist/70 p-1 backdrop-blur-md" aria-label="Main">
            {nav("/portfolio", "Portfolio")}
            {nav("/protect", "New plan")}
          </nav>
        )}

        <div className={`flex items-center gap-1.5 ${me ? "" : "ml-auto"}`}>
          {me ? (
            <>
              {me.balance && (
                <span className={`${pill} num hidden bg-paper/90 text-ink-2 backdrop-blur-md lg:inline-flex`} title="Free balance on Strike">
                  {usd(me.balance.available)}
                </span>
              )}
              <button
                onClick={async () => {
                  await signOut();
                  router.push("/");
                }}
                className={`${pill} num bg-paper/90 text-ink-2 backdrop-blur-md hover:text-ink`}
                title="Sign out"
              >
                <span className="hidden md:inline">{shortAddr(me.address)}</span>
                <span className="md:hidden">Sign out</span>
              </button>
            </>
          ) : (
            path !== "/" && (
              <Link href="/" className={`${pill} bg-cobalt text-paper hover:bg-cobalt-deep`}>
                Connect wallet
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
