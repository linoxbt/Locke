"use client";

import { useState } from "react";
import { signText } from "@/lib/cardano/wallet";
import { api, errorMessage } from "@/lib/ui/api";
import { usd } from "@/lib/ui/format";
import { Button, ErrorNote, Field, inputCls, Sheet } from "./ui";
import { useWallet } from "./WalletProvider";

/** Withdraw free balance from Strike back to the connected wallet as ADA. Wallet-signed. */
export function WithdrawSheet({ open, onClose, available }: { open: boolean; onClose(): void; available: number }) {
  const { ensureWallet, refreshMe } = useWallet();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const w = await ensureWallet();
      const q = await api<{ withdrawId: string; messageHex: string; txCbor: string | null }>("/api/withdraw/quote", {
        body: { usd: Number(amount) },
      });
      const signature = await signText(w, q.messageHex, true);
      const signedTxCbor = q.txCbor ? await w.api.signTx(q.txCbor, true) : undefined;
      await api("/api/withdraw/confirm", { body: { withdrawId: q.withdrawId, signature, signedTxCbor } });
      setDone(true);
      void refreshMe();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Withdraw to your wallet">
      {done ? (
        <p className="text-sm text-muted">Withdrawal submitted. ADA arrives in your connected wallet once Strike settles it.</p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Free balance on Strike: <span className="num text-text">{usd(available)}</span>. Funds can only go to the wallet you signed in
            with. Strike charges $1; the minimum is $5.
          </p>
          <Field label="Amount (USD)">
            <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25" />
          </Field>
          <ErrorNote error={error} />
          <Button className="w-full" busy={busy} disabled={!(Number(amount) >= 5) || Number(amount) > available} onClick={submit}>
            Sign withdrawal
          </Button>
        </div>
      )}
    </Sheet>
  );
}
