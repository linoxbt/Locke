"use client";

import { api } from "@/lib/ui/api";
import { signAndSubmit, walletUtxos, type ConnectedWallet } from "@/lib/cardano/wallet";
import { CARDANOSCAN } from "@/lib/ui/format";

export type DepositStep = "quote" | "sign" | "submitted" | "confirmed" | "open";

interface Prepared {
  needed: boolean;
  depositId?: string;
  unsignedTx?: string;
  lovelace?: string;
  usdValue?: number;
}

/** quote → wallet signs and submits → Strike told the tx hash. Returns null when no deposit was needed. */
export async function runDeposit(opts: {
  wallet: ConnectedWallet;
  planId: string;
  purpose: "open" | "topup";
  amountUsd?: number;
  onStep(step: DepositStep, info?: { txHash?: string; lovelace?: string; usd?: number }): void;
}): Promise<{ txHash: string } | null> {
  const { wallet, planId, purpose, amountUsd, onStep } = opts;
  onStep("quote");
  const utxos = await walletUtxos(wallet);
  const prep = await api<Prepared>(`/api/plans/${planId}/deposit`, {
    body: { purpose, amountUsd, address: wallet.address, utxos },
  });
  if (!prep.needed) return null;
  onStep("sign", { lovelace: prep.lovelace, usd: prep.usdValue });
  const txHash = await signAndSubmit(wallet, prep.unsignedTx!);
  await api(`/api/deposits/${prep.depositId}/confirm`, { body: { txHash } });
  onStep("submitted", { txHash, lovelace: prep.lovelace, usd: prep.usdValue });
  return { txHash };
}

const STEPS: { key: DepositStep; label: string }[] = [
  { key: "quote", label: "Quote" },
  { key: "sign", label: "Sign in wallet" },
  { key: "submitted", label: "Submitted" },
  { key: "confirmed", label: "Credited on Strike" },
  { key: "open", label: "Hedge open" },
];

export function StepTracker({ step, txHash, failed, skipDeposit }: { step: DepositStep; txHash?: string; failed?: boolean; skipDeposit?: boolean }) {
  const idx = STEPS.findIndex((s) => s.key === step);
  const steps = skipDeposit ? STEPS.filter((s) => s.key === "quote" || s.key === "open") : STEPS;
  return (
    <div>
      <ol className="space-y-3">
        {steps.map((s) => {
          const i = STEPS.findIndex((x) => x.key === s.key);
          const done = i < idx || (i === idx && s.key === "open");
          const current = i === idx && !done;
          return (
            <li key={s.key} className="flex items-center gap-3">
              <span
                className={`num flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                  done ? "border-accent bg-accent text-bg" : current ? (failed ? "border-danger text-danger" : "border-accent text-accent") : "border-line text-faint"
                }`}
              >
                {done ? "✓" : current && !failed ? <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> : i + 1}
              </span>
              <span className={done || current ? "text-text" : "text-faint"}>{s.label}</span>
            </li>
          );
        })}
      </ol>
      {txHash && (
        <a className="num mt-4 block break-all text-xs text-accent underline" href={`${CARDANOSCAN}${txHash}`} target="_blank" rel="noreferrer">
          tx {txHash}
        </a>
      )}
    </div>
  );
}
