"use client";

import { api } from "@/lib/ui/api";
import { signAndSubmit, walletUtxos, type ConnectedWallet } from "@/lib/cardano/wallet";
import { CARDANOSCAN, shortAddr } from "@/lib/ui/format";

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

const STEPS: { key: DepositStep; label: string; hint: string }[] = [
  { key: "quote", label: "Quote", hint: "Strike prices the ADA deposit" },
  { key: "sign", label: "Sign in your wallet", hint: "One transaction, margin only" },
  { key: "submitted", label: "Submitted to Cardano", hint: "Usually 1–3 minutes to confirm" },
  { key: "confirmed", label: "Credited on Strike", hint: "Isolated margin and leverage set" },
  { key: "open", label: "Hedge open", hint: "Locke is watching it now" },
];

export function StepTracker({ step, txHash, failed, skipDeposit }: { step: DepositStep; txHash?: string; failed?: boolean; skipDeposit?: boolean }) {
  const idx = STEPS.findIndex((s) => s.key === step);
  const steps = skipDeposit ? STEPS.filter((s) => s.key === "quote" || s.key === "confirmed" || s.key === "open") : STEPS;
  return (
    <div>
      <ol className="space-y-2">
        {steps.map((s) => {
          const i = STEPS.findIndex((x) => x.key === s.key);
          const done = i < idx || (i === idx && s.key === "open");
          const current = i === idx && !done;
          return (
            <li
              key={s.key}
              className={`flex items-center gap-4 rounded-2xl px-4 py-4 transition ${current ? (failed ? "bg-danger/10" : "bg-paper") : done ? "bg-paper/60" : ""}`}
              aria-current={current ? "step" : undefined}
            >
              <span
                className={`num grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] ${
                  done ? "bg-ink text-lime" : current ? (failed ? "bg-danger text-paper" : "bg-cobalt text-paper") : "bg-mist text-ink-3"
                }`}
              >
                {done ? "✓" : current && !failed ? <span className="h-2 w-2 animate-pulse rounded-full bg-paper" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className={`block text-[16px] ${done || current ? "text-ink" : "text-ink-3"}`}>{s.label}</span>
                <span className="block text-[13px] text-ink-3">{s.hint}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {txHash && (
        <a className="num mt-4 inline-flex rounded-full bg-paper px-4 py-2 text-[13px] text-cobalt" href={`${CARDANOSCAN}${txHash}`} target="_blank" rel="noreferrer">
          View transaction {shortAddr(txHash)} ↗
        </a>
      )}
    </div>
  );
}
