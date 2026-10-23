"use client";

import { api, ApiError } from "@/lib/ui/api";
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

// A deposit that reached Cardano must reach Locke too, even if the tab closes or the network drops
// between submitting and confirming. The hash is kept in localStorage until the server has it.
const PENDING = "locke.pendingDeposits";

type Pending = Record<string, string>; // depositId → txHash

function readPending(): Pending {
  try {
    return JSON.parse(localStorage.getItem(PENDING) ?? "{}") as Pending;
  } catch {
    return {};
  }
}

function writePending(p: Pending) {
  try {
    if (Object.keys(p).length) localStorage.setItem(PENDING, JSON.stringify(p));
    else localStorage.removeItem(PENDING);
  } catch {
    /* storage unavailable: the server still matches the deposit from Strike's history */
  }
}

async function confirmOnce(depositId: string, txHash: string): Promise<boolean> {
  try {
    await api(`/api/deposits/${depositId}/confirm`, { body: { txHash } });
    return true;
  } catch (e) {
    // A 4xx is final (unknown deposit, different tx): retrying won't help.
    if (e instanceof ApiError && e.status >= 400 && e.status < 500) return true;
    return false;
  }
}

/** Tell the server about a submitted deposit, retrying through brief outages. */
async function confirmWithRetry(depositId: string, txHash: string) {
  writePending({ ...readPending(), [depositId]: txHash });
  for (const wait of [0, 1500, 4000, 8000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    if (await confirmOnce(depositId, txHash)) {
      const rest = readPending();
      delete rest[depositId];
      writePending(rest);
      return;
    }
  }
  // Still pending: resumePendingDeposits retries on the next visit.
}

/** Send any deposit hashes a previous visit couldn't deliver. Call on pages that show deposits. */
export async function resumePendingDeposits(): Promise<boolean> {
  const pending = readPending();
  if (!Object.keys(pending).length) return false;
  for (const [depositId, txHash] of Object.entries(pending)) {
    if (await confirmOnce(depositId, txHash)) {
      const rest = readPending();
      delete rest[depositId];
      writePending(rest);
    }
  }
  return true;
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
  // Show the hash straight away: the ADA has left the wallet whatever happens next.
  onStep("submitted", { txHash, lovelace: prep.lovelace, usd: prep.usdValue });
  await confirmWithRetry(prep.depositId!, txHash);
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
                <span className={`block text-[14px] ${done || current ? "text-ink" : "text-ink-3"}`}>{s.label}</span>
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
