"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/ui/api";
import { Arrow, ErrorNote, Spinner } from "./ui";
import { useWallet, type SignInStep } from "./WalletProvider";

type Stage = SignInStep | "done" | null;

const STEPS = [
  { title: "Choose a wallet", body: "The one that holds your ADA." },
  { title: "Approve access", body: "Your wallet shares your address." },
  { title: "Sign one message", body: "Links the wallet to Strike through Locke." },
  { title: "Signed in", body: "Locke takes you to your plans." },
];

// Wallets we point people to when they have none (or not these).
const INSTALL = [
  { id: "eternl", name: "Eternl", href: "https://eternl.io" },
  { id: "lace", name: "Lace", href: "https://www.lace.io" },
  { id: "vespr", name: "Vespr", href: "https://vespr.xyz" },
];

function stageIndex(stage: Stage): number {
  return stage === "approve" ? 1 : stage === "sign" ? 2 : stage === "finish" || stage === "done" ? 3 : 0;
}

function tileStatus(stage: Stage, name: string): string {
  if (stage === "approve") return `Approve access in ${name}…`;
  if (stage === "sign") return `Sign the message in ${name}…`;
  if (stage === "finish") return "Checking your signature with Strike…";
  if (stage === "done") return "Signed in. Taking you in…";
  return "Detected in this browser";
}

/**
 * The sign-in page: a dark panel that shows what signing does (step track, the exact message the
 * wallet will show, three facts) beside the wallet chooser. One flow, so both sides share state.
 */
export function ConnectExperience({ next, builder, feeBps }: { next: string; builder: string | null; feeBps: number | null }) {
  const { wallets, signIn } = useWallet();
  const router = useRouter();
  const [active, setActive] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Extensions inject window.cardano a moment after load; don't say "none" before they've had the chance.
  const [scanned, setScanned] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setScanned(true), 1700);
    return () => clearTimeout(t);
  }, []);

  const connect = async (id: string) => {
    setActive(id);
    setError(null);
    setMessage(null);
    try {
      await signIn(id, (s, msg) => {
        setStage(s);
        if (msg) setMessage(msg);
      });
      setStage("done");
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
      setStage(null);
      setActive(null);
    }
  };

  const at = stageIndex(stage);
  const feePct = feeBps == null ? null : `${(feeBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  const missing = INSTALL.filter((w) => !wallets.some((d) => d.id === w.id || d.name.toLowerCase().includes(w.id)));

  return (
    <section className="grid min-h-[100svh] grid-cols-1 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
      {/* A — what this is (dark) */}
      <div className="bg-ink px-5 pb-10 pt-28 text-paper sm:px-10 lg:px-14 lg:pt-32">
        <p className="eyebrow text-lime">Sign in to Locke</p>
        <h1 className="display mt-6 max-w-[13ch] text-[36px] leading-[1.02] sm:text-[48px] lg:text-[56px]">
          One signature. <span className="text-paper/45">Then Locke keeps watch.</span>
        </h1>
        <ol className="mt-10 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-4">
          {STEPS.map((s, i) => {
            const state = i < at ? "done" : i === at ? "now" : "next";
            return (
              <li key={s.title} aria-current={state === "now" ? "step" : undefined}>
                <span className="block h-1 overflow-hidden rounded-full bg-paper/15">
                  <span
                    className={`block h-full rounded-full bg-lime transition-[width] duration-500 ${
                      state === "done" ? "w-full" : state === "now" ? (stage ? "w-1/2 animate-pulse" : "w-1/4") : "w-0"
                    }`}
                  />
                </span>
                <span className={`num mt-3 block text-[11px] ${state === "next" ? "text-paper/35" : "text-lime"}`}>0{i + 1}</span>
                <span className={`mt-1 block text-[15px] ${state === "next" ? "text-paper/45" : "text-paper"}`}>{s.title}</span>
                <span className="mt-1 hidden text-[13px] leading-snug text-paper/45 sm:block">{s.body}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* B — the wallet chooser */}
      <div className="flex flex-col bg-canvas px-5 py-10 sm:px-10 lg:row-span-2 lg:px-14 lg:pb-14 lg:pt-32">
        <p className="eyebrow text-ink-2">Step 01</p>
        <h2 className="display mt-4 text-[28px] leading-[1.05] sm:text-[34px]">
          Choose your wallet. <span className="text-ink-3">The one that holds your ADA.</span>
        </h2>

        <div className="mt-8 space-y-2.5">
          {wallets.length === 0 && !scanned && (
            <div className="flex h-[76px] items-center gap-4 rounded-[16px] bg-paper px-5 text-[15px] text-ink-2">
              <Spinner /> Looking for wallets in this browser…
            </div>
          )}
          {wallets.length === 0 && scanned && (
            <div className="rounded-[16px] bg-paper p-5 text-[15px] leading-relaxed text-ink-2">
              No Cardano wallet found in this browser. Install one below, set it to mainnet, then reload this page.
            </div>
          )}
          {wallets.map((w) => {
            const mine = active === w.id;
            const muted = !!active && !mine;
            return (
              <button
                key={w.id}
                onClick={() => connect(w.id)}
                disabled={!!active}
                className={`group flex w-full items-center gap-4 rounded-[16px] bg-paper p-4 text-left transition duration-300 sm:p-5 ${
                  mine ? "ring-2 ring-cobalt" : "ring-1 ring-transparent hover:-translate-y-0.5 hover:ring-line"
                } ${muted ? "opacity-40" : ""}`}
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-mist">
                  {w.icon ? (
                    <img src={w.icon} alt="" className="h-8 w-8" />
                  ) : (
                    <span className="display text-[20px]">{w.name.slice(0, 1)}</span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[17px] font-medium">{w.name}</span>
                  <span className={`mt-0.5 flex items-center gap-2 text-[13px] ${mine ? "text-cobalt" : "text-ink-2"}`}>
                    {!mine && <span className="h-1.5 w-1.5 rounded-full bg-ok" />}
                    {mine ? tileStatus(stage, w.name) : tileStatus(null, w.name)}
                  </span>
                </span>
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors ${
                    mine ? "bg-transparent" : "bg-ink text-paper group-hover:bg-cobalt"
                  }`}
                >
                  {mine ? <Spinner /> : <Arrow />}
                </span>
              </button>
            );
          })}
        </div>

        <ErrorNote error={error} />

        {missing.length > 0 && (
          <div className="mt-10">
            <p className="text-[13px] text-ink-2">{wallets.length ? "Other wallets that work with Locke" : "Wallets that work with Locke"}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {missing.map((w) => (
                <a
                  key={w.id}
                  href={w.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-mist px-4 text-[14px] text-ink transition-colors hover:bg-line"
                >
                  Get {w.name} <span aria-hidden>↗</span>
                </a>
              ))}
            </div>
          </div>
        )}

        <p className="mt-auto pt-12 text-[13px] leading-relaxed text-ink-3">
          Cardano mainnet. Locke never sees your recovery phrase, and signing this message doesn&apos;t move funds or cost a fee.
        </p>
      </div>

      {/* C — exactly what you'll sign, and what it means (dark) */}
      <div className="bg-ink px-5 pb-14 pt-10 text-paper sm:px-10 lg:px-14 lg:pt-0">
        <div className={`rounded-[16px] p-5 ring-1 transition sm:p-6 ${stage === "sign" ? "bg-paper/10 ring-lime" : "bg-paper/5 ring-paper/10"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[14px] text-paper/70">{message ? "The message in your wallet" : "What your wallet will ask you to sign"}</p>
            <span className={`num rounded-full px-3 py-1 text-[11px] ${stage === "sign" ? "bg-lime text-ink" : "bg-paper/10 text-paper/60"}`}>
              {stage === "sign" ? "waiting for your signature" : "Strike · builder connect"}
            </span>
          </div>
          <MessagePreview message={message} builder={builder} feePct={feePct} />
        </div>

        <dl className="mt-8 grid grid-cols-3 gap-4">
          {[
            ["0 ADA", "moves when you sign"],
            [feePct ?? "—", "builder fee per trade, nothing else"],
            ["1 wallet", "the only place withdrawals can go"],
          ].map(([v, l]) => (
            <div key={l}>
              <dt className="sr-only">{l}</dt>
              <dd className="num text-[22px] leading-none text-lime sm:text-[28px]">{v}</dd>
              <dd className="mt-2 text-[12px] leading-snug text-paper/55 sm:text-[13px]">{l}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/** Strike's challenge text: the real one once it arrives, a faithful outline before. The fee line is highlighted. */
function MessagePreview({ message, builder, feePct }: { message: string | null; builder: string | null; feePct: string | null }) {
  const lines = message
    ? message.split("\n").filter((l) => l.trim())
    : [
        `Connect to Strike via builder "${builder ?? "Locke"}".`,
        `This authorizes the builder to collect up to ${feePct ?? "a set"} fee on your trades.`,
        "By signing, you are entrusting your API wallet private key to this builder.",
        "Wallet: your address",
        "Chain: cardano",
        "API Key: made for you by Locke",
        "Nonce: one-time",
      ];
  return (
    <div className="num mt-5 space-y-1.5 break-words text-[12px] leading-relaxed text-paper/75 sm:text-[13px]">
      {lines.map((l, i) => (
        <p key={i} className={/fee/i.test(l) ? "text-lime" : /^(Wallet|Chain|API Key|Nonce|Timestamp):/.test(l) ? "text-paper/45" : ""}>
          {l}
        </p>
      ))}
    </div>
  );
}
