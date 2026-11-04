"use client";

import { useEffect, useState } from "react";
import { BaseMark } from "./base/BaseMark";
import { SignInWithBase } from "./base/SignInWithBase";

const STEPS = ["Choose", "Approve", "Sign"];

/**
 * The sign-in page: a dark panel that says what signing does (the steps, the message the wallet
 * will show, a few facts) beside Sign in with Base.
 */
export function ConnectExperience({ next, reconnect = false }: { next: string; reconnect?: boolean }) {
  // The message names this site: read the host after mount, so the server render matches the first paint.
  const [host, setHost] = useState("this site");
  useEffect(() => setHost(window.location.host), []);

  return (
    <section className="grid min-h-[100svh] grid-cols-1 lg:grid-cols-2 lg:grid-rows-[auto_1fr]">
      {/* A — headline and steps (dark) */}
      <div className="bg-ink px-5 pb-8 pt-24 text-paper sm:px-10 lg:px-14 lg:pt-28">
        <h1 className="display text-[26px] leading-[1.05] sm:text-[32px]">
          One signature. <span className="text-paper/45">No funds move.</span>
        </h1>
        <ol className="mt-6 grid max-w-[420px] grid-cols-3 gap-3">
          {STEPS.map((title, i) => (
            <li key={title}>
              <span className="block h-1 rounded-full bg-paper/15" />
              <span className="mt-2 block text-[13px] text-paper/80">
                <span className="num text-lime">{i + 1}</span> {title}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* B — sign in */}
      <div className="flex flex-col bg-canvas px-5 py-8 sm:px-10 lg:row-span-2 lg:px-14 lg:pb-10 lg:pt-28">
        <h2 className="display flex items-center gap-2.5 text-[20px] sm:text-[22px]">
          <BaseMark size={14} /> Sign in on Base
        </h2>
        <p className="mt-2 max-w-[460px] text-[14px] leading-relaxed text-ink-2">
          With Base Account (Coinbase Wallet): a passkey, no extension or seed phrase. A wallet already in this browser works too.
        </p>
        {reconnect && (
          <p role="status" className="mt-4 max-w-[460px] rounded-xl bg-watch/25 px-4 py-3 text-[13px] text-ink">
            Your session ended. Sign in again to pick up where you left off.
          </p>
        )}
        <div className="mt-5 max-w-[460px] rounded-[14px] bg-paper p-4">
          <SignInWithBase next={next} />
        </div>

        <p className="mt-auto pt-10 text-[12px] leading-relaxed text-ink-3">Base mainnet · signing is free</p>
      </div>

      {/* C — what you'll sign (dark) */}
      <div className="bg-ink px-5 pb-10 pt-6 text-paper sm:px-10 lg:px-14 lg:pt-0">
        <div className="max-w-[520px] rounded-[14px] bg-paper/5 p-4 ring-1 ring-paper/10">
          <p className="text-[12px] text-paper/60">Your wallet will ask you to sign</p>
          <div className="num mt-2 space-y-1 break-words text-[12px] leading-relaxed text-paper/75">
            <p>{host} wants you to sign in with your Ethereum account:</p>
            <p className="text-paper/60">your address</p>
            <p className="text-lime">Sign in to Locke on Base.</p>
            <p className="text-paper/60">Chain ID: 8453 · Nonce: one-time</p>
          </div>
        </div>

        <ul className="mt-4 flex flex-wrap gap-1.5">
          {["No transaction, no gas", "Your vault, your withdrawals", "One-time code, 10 minutes"].map((t) => (
            <li key={t} className="num rounded-full bg-paper/10 px-3 py-1 text-[11px] text-paper/70">
              {t}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
