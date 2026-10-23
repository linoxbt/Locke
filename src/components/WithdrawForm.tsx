"use client";

import { useState } from "react";
import { Field } from "./form";
import { Arrow, Button, Card, ErrorNote, inputCls, LinkButton } from "./ui";
import { useWallet } from "./WalletProvider";
import { signFull, signText } from "@/lib/cardano/wallet";
import { api, errorMessage } from "@/lib/ui/api";
import { usd } from "@/lib/ui/format";

interface Quote {
  withdrawId: string;
  fee: string;
  messageHex: string;
  txCbor: string | null;
  estimatedReceive: string | null;
}

/** Withdraw free balance from Strike back to the connected wallet as ADA: quote, review the fee, then sign. */
export function WithdrawForm({ available }: { available: number | null }) {
  const { ensureWallet, refreshMe } = useWallet();
  const [amount, setAmount] = useState(available != null && available >= 5 ? String(Math.floor(available)) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [done, setDone] = useState(false);
  const amt = Number(amount);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const getQuote = () => run(async () => setQuote(await api<Quote>("/api/withdraw/quote", { body: { usd: amt } })));

  const sign = () =>
    run(async () => {
      const q = quote!;
      const w = await ensureWallet();
      const signature = await signText(w, q.messageHex, true);
      // Strike wants the whole signed transaction, not just the wallet's witness set.
      const signedTxCbor = q.txCbor ? await signFull(w, q.txCbor) : undefined;
      await api("/api/withdraw/confirm", { body: { withdrawId: q.withdrawId, signature, signedTxCbor } });
      setDone(true);
      void refreshMe();
    });

  if (done) {
    return (
      <Card>
        <h2 className="display text-[18px]">Withdrawal submitted.</h2>
        <p className="mt-3 text-[14px] text-ink-2">ADA arrives in your connected wallet once Strike settles it.</p>
        <LinkButton href="/portfolio" className="mt-6">
          Back to portfolio <Arrow />
        </LinkButton>
      </Card>
    );
  }

  if (quote) {
    const fee = Number(quote.fee);
    const receive = quote.estimatedReceive != null ? Number(quote.estimatedReceive) : null;
    return (
      <Card className="space-y-4">
        <h2 className="display text-[18px]">Review the withdrawal</h2>
        <dl className="num grid grid-cols-2 gap-y-2 text-[14px]">
          <dt className="text-ink-3">Amount</dt>
          <dd className="text-right">{usd(amt)}</dd>
          <dt className="text-ink-3">Strike fee</dt>
          <dd className="text-right">{Number.isFinite(fee) ? usd(fee) : quote.fee}</dd>
          {receive != null && Number.isFinite(receive) && (
            <>
              <dt className="text-ink-3">You receive about</dt>
              <dd className="text-right">{receive.toLocaleString("en-US", { maximumFractionDigits: 2 })} ADA</dd>
            </>
          )}
        </dl>
        <p className="text-[13px] text-ink-2">Your wallet signs twice: once to approve, once for the transaction. It goes only to the wallet you signed in with.</p>
        <ErrorNote error={error} />
        <div className="flex flex-wrap gap-2">
          <Button size="lg" className="flex-1 justify-between" busy={busy} onClick={sign}>
            Sign withdrawal <Arrow />
          </Button>
          <Button size="lg" variant="ghost" disabled={busy} onClick={() => (setQuote(null), setError(null))}>
            Change amount
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-4">
      <Field label="Amount in USD" hint="Strike charges a small fee per withdrawal; the minimum is $5.">
        <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25" />
      </Field>
      <ErrorNote error={error} />
      <Button size="lg" className="w-full justify-between" busy={busy} disabled={!(amt >= 5) || (available != null && amt > available)} onClick={getQuote}>
        Review fee <Arrow />
      </Button>
    </Card>
  );
}
