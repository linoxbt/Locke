"use client";

import { useState } from "react";
import { Field } from "./form";
import { Arrow, Button, Card, ErrorNote, inputCls, LinkButton } from "./ui";
import { useWallet } from "./WalletProvider";
import { signText } from "@/lib/cardano/wallet";
import { api, errorMessage } from "@/lib/ui/api";

/** Withdraw free balance from Strike back to the connected wallet as ADA. Wallet-signed. */
export function WithdrawForm({ available }: { available: number | null }) {
  const { ensureWallet, refreshMe } = useWallet();
  const [amount, setAmount] = useState(available != null && available >= 5 ? String(Math.floor(available)) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const amt = Number(amount);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const w = await ensureWallet();
      const q = await api<{ withdrawId: string; messageHex: string; txCbor: string | null }>("/api/withdraw/quote", { body: { usd: amt } });
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

  if (done) {
    return (
      <Card>
        <h2 className="display text-[22px]">Withdrawal submitted.</h2>
        <p className="mt-3 text-[15px] text-ink-2">ADA arrives in your connected wallet once Strike settles it.</p>
        <LinkButton href="/portfolio" className="mt-8">
          Back to portfolio <Arrow />
        </LinkButton>
      </Card>
    );
  }

  return (
    <Card className="space-y-6">
      <Field label="Amount in USD" hint="Strike charges $1 per withdrawal; the minimum is $5.">
        <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25" />
      </Field>
      <ErrorNote error={error} />
      <Button size="lg" className="w-full justify-between" busy={busy} disabled={!(amt >= 5) || (available != null && amt > available)} onClick={submit}>
        Sign withdrawal <Arrow />
      </Button>
    </Card>
  );
}
