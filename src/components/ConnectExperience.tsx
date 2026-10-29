"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isMobileBrowser, okxUnsupportedReason, walletAppLinks, type WalletAppLink } from "@/lib/cardano/wallet";
import { api, errorMessage } from "@/lib/ui/api";
import { BaseMark } from "./base/BaseMark";
import { SignInWithBase } from "./base/SignInWithBase";
import { Arrow, ErrorNote, Spinner } from "./ui";
import { useWallet, type SignInStep } from "./WalletProvider";

type Stage = SignInStep | "done" | null;

const STEPS = ["Choose", "Approve", "Sign"];

// Wallets we point people to when they have none (or not these).
const INSTALL = [
  { id: "eternl", name: "Eternl", href: "https://eternl.io" },
  { id: "lace", name: "Lace", href: "https://www.lace.io" },
  { id: "vespr", name: "Vespr", href: "https://vespr.xyz" },
];

function stageIndex(stage: Stage): number {
  return stage === "approve" ? 1 : stage === "sign" ? 2 : stage === "finish" || stage === "done" ? 3 : 0;
}

/** What this browser can do, read after mount (the server render can't know, and must match the first paint). */
interface Device {
  mobile: boolean;
  /** Why OKX can't sign in to a Cardano site here (its app, or a mobile browser), or null. */
  okxUnsupported: string | null;
  /** Links that open this page in a wallet app's browser. */
  appLinks: WalletAppLink[];
}

function tileStatus(stage: Stage, name: string, unsupported: boolean): string {
  if (stage === "approve") return `Approve access in ${name}…`;
  if (stage === "sign") return `Sign the message in ${name}…`;
  if (stage === "finish") return "Checking with Strike…";
  if (stage === "done") return "Signed in";
  if (unsupported) return "Detected · no Cardano sign-in here yet";
  return "Detected";
}

/**
 * The sign-in page: a dark panel that shows what signing does (step track, the message the wallet
 * will show, three facts) beside the chooser: Sign in with Base, then the Cardano wallets. The
 * dark panel follows the Cardano flow, so both sides share its state.
 */
export function ConnectExperience({
  next,
  feeBps,
  reconnect = false,
}: {
  next: string;
  feeBps: number | null;
  reconnect?: boolean;
}) {
  const { wallets, signIn } = useWallet();
  const router = useRouter();
  const [active, setActive] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Extensions inject window.cardano a moment after load; don't say "none" before they've had the chance.
  const [scanned, setScanned] = useState(false);
  const [device, setDevice] = useState<Device>({ mobile: false, okxUnsupported: null, appLinks: [] });
  useEffect(() => {
    const t = setTimeout(() => setScanned(true), 3000);
    // The link back into Locke keeps ?next=, so signing in inside the wallet app lands on the same page.
    setDevice({ mobile: isMobileBrowser(), okxUnsupported: okxUnsupportedReason(), appLinks: walletAppLinks(window.location.href) });
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
  const unsupported = (id: string) => id === "okxwallet" && !!device.okxUnsupported;
  // On a phone, a browser with no wallet that can sign in (none, or only OKX) is a dead end: offer the wallet apps.
  const usable = wallets.filter((w) => !unsupported(w.id));
  const offerApps = device.mobile && usable.length === 0 && (scanned || wallets.length > 0);

  return (
    <section className="grid min-h-[100svh] grid-cols-1 lg:grid-cols-2 lg:grid-rows-[auto_1fr]">
      {/* A — headline and progress (dark) */}
      <div className="bg-ink px-5 pb-8 pt-24 text-paper sm:px-10 lg:px-14 lg:pt-28">
        <h1 className="display text-[26px] leading-[1.05] sm:text-[32px]">
          One signature. <span className="text-paper/45">No funds move.</span>
        </h1>
        <ol className="mt-6 grid max-w-[420px] grid-cols-3 gap-3">
          {STEPS.map((title, i) => {
            const state = i < at ? "done" : i === at ? "now" : "next";
            return (
              <li key={title} aria-current={state === "now" ? "step" : undefined}>
                <span className="block h-1 overflow-hidden rounded-full bg-paper/15">
                  <span
                    className={`block h-full rounded-full bg-lime transition-[width] duration-500 ${
                      state === "done" ? "w-full" : state === "now" ? (stage ? "w-1/2 animate-pulse" : "w-1/4") : "w-0"
                    }`}
                  />
                </span>
                <span className={`mt-2 block text-[13px] ${state === "next" ? "text-paper/60" : "text-paper"}`}>{title}</span>
              </li>
            );
          })}
        </ol>
        {/* The progress above is visual; screen readers hear each stage as it changes. */}
        <p className="sr-only" aria-live="polite">
          {active && stage ? tileStatus(stage, wallets.find((w) => w.id === active)?.name ?? "your wallet", false) : ""}
        </p>
      </div>

      {/* B — the wallet chooser */}
      <div className="flex flex-col bg-canvas px-5 py-8 sm:px-10 lg:row-span-2 lg:px-14 lg:pb-10 lg:pt-28">
        <h2 className="display text-[20px] sm:text-[22px]">Choose how to sign in</h2>

        <h3 className="eyebrow mt-6 flex items-center gap-2 text-ink-2">
          <BaseMark size={12} /> On Base
        </h3>
        <div className={`mt-3 max-w-[460px] rounded-[14px] bg-paper p-4 transition ${active ? "pointer-events-none opacity-40" : ""}`}>
          <SignInWithBase next="/base" />
        </div>

        <h3 className="eyebrow mt-8 text-ink-2">On Cardano · with Strike</h3>
        <div className="mt-3 max-w-[460px] space-y-2">
          {wallets.length === 0 && !scanned && (
            <div className="flex h-16 items-center gap-3 rounded-[14px] bg-paper px-4 text-[13px] text-ink-2">
              <Spinner /> Looking for wallets…
            </div>
          )}
          {wallets.length === 0 && scanned && !device.mobile && (
            <div className="rounded-[14px] bg-paper p-4 text-[13px] leading-relaxed text-ink-2">No Cardano wallet found. Install one below, then reload.</div>
          )}
          {offerApps && <OpenInWalletApp links={device.appLinks} okxUnsupported={wallets.some((w) => unsupported(w.id)) ? device.okxUnsupported : null} />}
          {wallets.map((w) => {
            const mine = active === w.id;
            const muted = !!active && !mine;
            return (
              <button
                key={w.id}
                onClick={() => connect(w.id)}
                disabled={!!active}
                className={`group flex w-full items-center gap-3 rounded-[14px] bg-paper p-3 text-left transition duration-300 ${
                  mine ? "ring-2 ring-cobalt" : "ring-1 ring-transparent hover:-translate-y-0.5 hover:ring-line"
                } ${muted ? "opacity-40" : ""}`}
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-mist">
                  {w.icon ? <img src={w.icon} alt="" className="h-6 w-6" /> : <span className="display text-[15px]">{w.name.slice(0, 1)}</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{w.name}</span>
                  <span className={`flex items-center gap-1.5 text-[12px] ${mine ? "text-cobalt" : "text-ink-3"}`}>
                    {!mine && <span className={`h-1.5 w-1.5 rounded-full ${unsupported(w.id) ? "bg-watch" : "bg-ok"}`} />}
                    {tileStatus(mine ? stage : null, w.name, unsupported(w.id))}
                  </span>
                </span>
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors ${
                    mine ? "bg-transparent" : "bg-ink text-paper group-hover:bg-cobalt"
                  }`}
                >
                  {mine ? <Spinner /> : <Arrow className="h-3.5 w-3.5" />}
                </span>
              </button>
            );
          })}
        </div>

        <div className="max-w-[460px]">
          {reconnect && !error && stage == null && (
            <p role="status" className="rounded-xl bg-watch/25 px-4 py-3 text-[13px] text-ink">
              Your session ended. Sign in again to pick up where you left off.
            </p>
          )}
          <ErrorNote error={error} />
        </div>

        {missing.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-1.5">
            {missing.map((w) => (
              <a
                key={w.id}
                href={w.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-mist px-3 text-[12px] text-ink-2 transition-colors hover:bg-line hover:text-ink"
              >
                Get {w.name} <span aria-hidden>↗</span>
              </a>
            ))}
          </div>
        )}

        <p className="mt-auto pt-10 text-[12px] leading-relaxed text-ink-3">
          Cardano mainnet · signing is free · By signing in you accept Locke&apos;s{" "}
          <Link href="/legal/terms" target="_blank" className="underline underline-offset-2 hover:text-ink">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/legal/privacy" target="_blank" className="underline underline-offset-2 hover:text-ink">
            Privacy Policy
          </Link>
          .
        </p>
      </div>

      {/* C — what you'll sign (dark) */}
      <div className="bg-ink px-5 pb-10 pt-6 text-paper sm:px-10 lg:px-14 lg:pt-0">
        <div className={`max-w-[520px] rounded-[14px] p-4 ring-1 transition ${stage === "sign" ? "bg-paper/10 ring-lime" : "bg-paper/5 ring-paper/10"}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] text-paper/60">With a Cardano wallet, you&apos;ll sign</p>
            {stage === "sign" && <span className="num rounded-full bg-lime px-2.5 py-0.5 text-[11px] text-ink">waiting for you</span>}
          </div>
          <MessagePreview message={message} feePct={feePct} />
        </div>

        <ul className="mt-4 flex flex-wrap gap-1.5">
          {["0 ADA moves", `${feePct ?? "—"} fee per trade`, "Withdrawals to this wallet only"].map((t) => (
            <li key={t} className="num rounded-full bg-paper/10 px-3 py-1 text-[11px] text-paper/70">
              {t}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Phones run no wallet extensions, so a phone signs in from inside a wallet app's own browser. Plain
 * links, followed straight from the tap: iOS ignores app links opened after any async work.
 */
function OpenInWalletApp({ links, okxUnsupported }: { links: WalletAppLink[]; okxUnsupported: string | null }) {
  return (
    <div className="rounded-[14px] bg-paper p-4">
      <p className="text-[14px] font-medium">Open Locke in your wallet app</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
        {okxUnsupported ? `${okxUnsupported} ` : "Phone browsers can't reach a Cardano wallet. "}
        Open this page in your wallet app&apos;s browser and sign in there.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {links.map((l) => (
          <a
            key={l.id}
            href={l.href}
            className="flex h-11 items-center justify-between gap-2 rounded-[12px] bg-ink px-4 text-[13px] text-paper transition-colors hover:bg-cobalt"
          >
            {l.name} <Arrow className="h-3.5 w-3.5" />
          </a>
        ))}
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
        Nothing happens? That wallet isn&apos;t installed: get one below, or open Locke on a computer with a wallet extension.
      </p>
    </div>
  );
}

/**
 * Strike's challenge: the connect and fee lines up front, the exact text (real once it arrives)
 * behind a toggle. The headline leaves out the builder code; the full message shows it verbatim.
 */
function MessagePreview({ message, feePct }: { message: string | null; feePct: string | null }) {
  const lines = message
    ? message.split("\n").filter((l) => l.trim())
    : [
        "Connect to Strike.",
        `This authorizes the builder to collect up to ${feePct ?? "a set"} fee on your trades.`,
        "By signing, you are entrusting your API wallet private key to this builder.",
        "Wallet: your address · Chain: cardano · API key: made for you · Nonce: one-time",
      ];
  const headline = lines.slice(0, 2).map((l) => l.replace(/\s+via builder\s+"[^"]*"/i, ""));
  const line = (l: string, i: number) => (
    <p key={i} className={/fee/i.test(l) ? "text-lime" : /^(Wallet|Chain|API Key|Nonce|Timestamp):/.test(l) ? "text-paper/60" : ""}>
      {l}
    </p>
  );
  return (
    <div className="num mt-2 break-words text-[12px] leading-relaxed text-paper/75">
      <div className="space-y-1">{headline.map(line)}</div>
      <details className="group mt-2">
        <summary className="cursor-pointer list-none text-[11px] text-paper/60 hover:text-paper/80">
          <span className="group-open:hidden">Full message +</span>
          <span className="hidden group-open:inline">Hide −</span>
        </summary>
        <div className="mt-2 space-y-1">{(message ? lines : lines.slice(2)).map((l, i) => line(l, i + 2))}</div>
      </details>
    </div>
  );
}
