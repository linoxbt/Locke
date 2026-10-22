"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ErrorNote } from "@/components/ui";
import { useWallet } from "@/components/WalletProvider";
import { errorMessage } from "@/lib/ui/api";

export default function ConnectPage() {
  const { me, loading, wallets, signIn } = useWallet();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && me) router.replace("/portfolio");
  }, [loading, me, router]);

  const connect = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await signIn(id);
      router.push("/protect");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl pt-8 sm:pt-16">
      <p className="num mb-4 text-xs uppercase tracking-[0.3em] text-accent">Protection plans · built on Strike</p>
      <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">
        Protect what your business holds.
        <br />
        <span className="text-muted">Manage what it needs to buy.</span>
      </h1>
      <p className="mt-5 max-w-xl text-base text-muted">
        Tell Locke what you want to protect — ADA in your treasury, or the fuel you buy every month — and Locke opens, sizes
        and watches a hedge for it on Strike. Your ADA stays in your wallet, still staked. Only the margin moves.
      </p>

      <div className="bracket accent mt-10 p-5">
        <h2 className="text-sm font-medium">Connect a Cardano wallet</h2>
        <p className="mt-1 text-xs text-muted">
          You&apos;ll sign one message to link your wallet to Strike through Locke. That signature can&apos;t move funds; every deposit and
          withdrawal asks your wallet again.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {wallets.length === 0 && (
            <p className="text-sm text-faint sm:col-span-2">
              No Cardano wallet found in this browser. Install{" "}
              <a className="text-accent underline" href="https://eternl.io" target="_blank" rel="noreferrer">Eternl</a> or{" "}
              <a className="text-accent underline" href="https://www.lace.io" target="_blank" rel="noreferrer">Lace</a>, then reload.
            </p>
          )}
          {wallets.map((w) => (
            <Button key={w.id} variant="ghost" busy={busy === w.id} disabled={!!busy} onClick={() => connect(w.id)} className="justify-start">
              {w.icon && <img src={w.icon} alt="" className="h-5 w-5" />}
              {w.name}
            </Button>
          ))}
        </div>
        <div className="mt-3">
          <ErrorNote error={error} />
        </div>
      </div>

      <ol className="mt-12 grid gap-4 sm:grid-cols-3">
        {[
          ["Describe", "Pick what to protect: ADA you hold, or fuel you buy."],
          ["Preview", "See the hedge, its cost, and outcomes at ±10%, ±25%, ±50%."],
          ["Fund and watch", "Sign one ADA deposit. Locke opens the hedge and alerts you before Strike would."],
        ].map(([t, d], i) => (
          <li key={t} className="border-l border-line pl-4">
            <span className="num text-xs text-accent">0{i + 1}</span>
            <h3 className="mt-1 font-medium">{t}</h3>
            <p className="mt-1 text-sm text-muted">{d}</p>
          </li>
        ))}
      </ol>

      <p className="mt-12 text-xs leading-relaxed text-faint">
        Locke is a tool, not financial advice. Hedges can lose money on their own, and positions can be liquidated if margin runs out.
        Strike has eligibility rules; check{" "}
        <a className="underline" href="https://docs.strikefinance.org" target="_blank" rel="noreferrer">Strike&apos;s restricted persons policy</a> before you use it.
      </p>
    </div>
  );
}
