"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { hasInjectedWallet, signInWithBase, walletErrorMessage, type WalletKind } from "@/lib/base/wallet";
import { ErrorNote } from "../ui";

/** Base's mark: a blue square with rounded corners. */
export function BaseMark({ size = 16 }: { size?: number }) {
  return <span aria-hidden className="inline-block shrink-0 rounded-[3px] bg-[#0000ff]" style={{ width: size, height: size }} />;
}

/**
 * Sign in with Base (Base Account: a passkey wallet, no extension or seed phrase), or with any EVM
 * wallet already in the browser. Both end in the same signed Sign-In with Ethereum message.
 */
export function SignInWithBase({ next = "/base" }: { next?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<WalletKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [injected, setInjected] = useState(false);
  useEffect(() => setInjected(hasInjectedWallet()), []);

  async function go(kind: WalletKind) {
    setBusy(kind);
    setError(null);
    try {
      await signInWithBase(kind);
      router.replace(next);
      router.refresh();
    } catch (e) {
      setError(walletErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => go("base")}
        disabled={busy !== null}
        aria-busy={busy === "base" || undefined}
        className="inline-flex h-12 items-center justify-center gap-3 rounded-full bg-ink px-6 text-[15px] font-medium text-paper transition hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy === "base" ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : <BaseMark />}
        Sign in with Base
      </button>
      {injected && (
        <button
          type="button"
          onClick={() => go("injected")}
          disabled={busy !== null}
          aria-busy={busy === "injected" || undefined}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-paper px-5 text-[14px] text-ink ring-1 ring-line ring-inset transition hover:ring-ink disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === "injected" && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
          Use the wallet in this browser
        </button>
      )}
      <p className="text-[12px] leading-relaxed text-ink-3">
        You sign a message to prove the account is yours. It costs nothing and moves no funds.
      </p>
      <ErrorNote error={error} />
    </div>
  );
}
