"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/ui/api";
import { Arrow, Button, ErrorNote } from "./ui";
import { useWallet } from "./WalletProvider";

export function ConnectPanel({ next }: { next: string }) {
  const { wallets, signIn } = useWallet();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await signIn(id);
      // A first-time user has no plans yet: send them to create one unless they were heading somewhere.
      if (next === "/portfolio") {
        const { plans } = await api<{ plans: unknown[] }>("/api/plans").catch(() => ({ plans: [1] }));
        router.replace(plans.length ? "/portfolio" : "/protect");
      } else {
        router.replace(next);
      }
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      {wallets.length === 0 && (
        <p className="rounded-2xl bg-mist p-4 text-[15px] text-ink-2">
          No Cardano wallet in this browser. Install{" "}
          <a className="text-ink underline underline-offset-4" href="https://eternl.io" target="_blank" rel="noreferrer">
            Eternl
          </a>{" "}
          or{" "}
          <a className="text-ink underline underline-offset-4" href="https://www.lace.io" target="_blank" rel="noreferrer">
            Lace
          </a>
          , then reload.
        </p>
      )}
      {wallets.map((w, i) => (
        <Button
          key={w.id}
          variant={i === 0 ? "primary" : "ghost"}
          size="lg"
          busy={busy === w.id}
          disabled={!!busy}
          onClick={() => connect(w.id)}
          className="w-full justify-between"
        >
          <span className="flex items-center gap-3">
            {w.icon && <img src={w.icon} alt="" className="h-6 w-6 rounded-md" />}
            Connect {w.name}
          </span>
          <Arrow />
        </Button>
      ))}
      <ErrorNote error={error} />
    </div>
  );
}
