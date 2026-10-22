"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Arrow, Button, Card, Display, ErrorNote, Eyebrow, SUBTLE } from "@/components/ui";
import { useWallet } from "@/components/WalletProvider";
import { api, errorMessage } from "@/lib/ui/api";
import { pct, price } from "@/lib/ui/format";

interface Market {
  mark: number;
  fundingRate: number;
}

export default function ConnectPage() {
  const { me, loading, wallets, signIn } = useWallet();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [market, setMarket] = useState<{ ada: Market; wti: Market } | null>(null);

  useEffect(() => {
    if (!loading && me) router.replace("/portfolio");
  }, [loading, me, router]);

  useEffect(() => {
    const load = () => api<{ ada: Market; wti: Market }>("/api/market").then(setMarket).catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  const connect = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await signIn(id);
      router.push("/protect");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Hero */}
      <section className="animate-rise pb-8 pt-6 sm:pb-14 sm:pt-12">
        <Eyebrow className="mb-6 text-ink-2">Protection plans · built on Strike</Eyebrow>
        <Display size="xl" lead="Protect what your business holds." rest="Manage what it needs to buy." className="max-w-[15ch]" />
        <p className="mt-8 max-w-[52ch] text-lg leading-relaxed text-ink-2">
          Tell Locke what you want to protect — ADA in your treasury, or the fuel you buy every month. Locke opens, sizes and watches a hedge
          for it on Strike. Your ADA stays in your wallet, still staked. Only the margin moves.
        </p>
      </section>

      {/* Bento */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Card id="connect" className="flex flex-col lg:col-span-5 lg:row-span-2">
          <Eyebrow className="text-ink-2">Start here</Eyebrow>
          <Display as="h2" size="md" lead="Connect a Cardano wallet." rest="One signature, no funds move." className="mt-4" />
          <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
            The signature links your wallet to Strike through Locke. Every deposit and withdrawal asks your wallet again.
          </p>
          <div className="mt-auto space-y-2 pt-8">
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
        </Card>

        <Card tone="cobalt" className="flex min-h-[280px] flex-col lg:col-span-4">
          <div className="flex items-start justify-between">
            <Eyebrow className={SUBTLE.cobalt}>01 · Holdings</Eyebrow>
            <span className="num rounded-full bg-paper/15 px-3 py-1 text-[12px]">ADA-USD</span>
          </div>
          <h3 className="display mt-auto pt-10 text-[34px] sm:text-[40px]">Protect what you hold</h3>
          <p className={`mt-3 text-[15px] ${SUBTLE.cobalt}`}>A direct hedge. If ADA falls, the hedge gains what your treasury loses.</p>
        </Card>

        <Card tone="lime" className="flex min-h-[280px] flex-col lg:col-span-3">
          <div className="flex items-start justify-between">
            <Eyebrow className={SUBTLE.lime}>02 · Costs</Eyebrow>
            <span className="num rounded-full bg-ink/10 px-3 py-1 text-[12px]">WTI-USD</span>
          </div>
          <h3 className="display mt-auto pt-10 text-[34px] sm:text-[40px]">Manage what you buy</h3>
          <p className={`mt-3 text-[15px] ${SUBTLE.lime}`}>A partial hedge on crude for the diesel you burn.</p>
        </Card>

        <Card tone="ink" className="lg:col-span-4">
          <div className="flex items-center justify-between">
            <Eyebrow className={SUBTLE.ink}>Live on Strike</Eyebrow>
            <span className="flex items-center gap-2 text-[12px] text-paper/60">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lime" aria-hidden />
              mark price
            </span>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-4">
            {[
              ["ADA-USD", market?.ada],
              ["WTI-USD", market?.wti],
            ].map(([sym, m]) => (
              <div key={sym as string}>
                <dt className="num text-[12px] text-paper/50">{sym as string}</dt>
                <dd className="num mt-1 text-[28px] leading-none sm:text-[32px]">{m ? price((m as Market).mark) : "—"}</dd>
                <dd className="num mt-2 text-[12px] text-paper/50">
                  funding {m ? `${pct((m as Market).fundingRate * 24, 3)}/day` : "—"}
                </dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card tone="mist" className="flex flex-col justify-between lg:col-span-3">
          <Eyebrow className="text-ink-2">Still staked</Eyebrow>
          <p className="display mt-8 text-[26px]">
            Your ADA keeps earning and voting. <span className="text-ink-3">The hedge lives on Strike.</span>
          </p>
        </Card>
      </div>

      {/* Interlude */}
      <Card tone="ink" as="section" className="!mt-16 px-6 py-16 sm:px-12 sm:py-24">
        <Display
          as="h2"
          size="lg"
          lead="Describe. Preview. Fund. Watch."
          rest="Every plan follows the same four steps."
          restClass="text-paper/45"
          className="mx-auto max-w-[18ch] text-center"
        />
        <ol className="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-[18px] bg-paper/10 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Describe", "ADA you hold, or litres you buy. Locke reads your wallet balance for you."],
            ["Preview", "Hedge size, margin, fees, the daily cost of protection, and outcomes from −50% to +50%."],
            ["Fund", "Sign one ADA deposit. Locke sets isolated margin and opens the hedge on Strike."],
            ["Watch", "Locke alerts you before Strike would, with a top-up ready to sign."],
          ].map(([t, d], i) => (
            <li key={t} className="bg-ink p-6 sm:p-8">
              <span className="num text-[13px] text-lime">0{i + 1}</span>
              <h3 className="display mt-10 text-[28px]">{t}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-paper/55">{d}</p>
            </li>
          ))}
        </ol>
      </Card>

      {/* Risk ladder */}
      <section className="grid grid-cols-1 gap-3 pt-16 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Display as="h2" size="lg" lead="Alerts before Strike's." rest="Not after." />
          <p className="mt-6 max-w-[44ch] text-[17px] leading-relaxed text-ink-2">
            A Cardano deposit takes minutes to confirm, so Locke warns early: on margin health, and on how close the price is to
            liquidation. Each plan has its own margin, so trouble in one never touches the other.
          </p>
          <Button className="mt-8" onClick={() => document.getElementById("connect")?.scrollIntoView({ behavior: "smooth" })}>
            Get started <Arrow />
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-7">
          {[
            { tone: "paper" as const, k: "Watch", v: "20% from liquidation", d: "The plan card turns amber. Nothing to do yet." },
            { tone: "watch" as const, k: "Action needed", v: "10% from liquidation", d: "One-tap top-up, sized to move liquidation 25% away." },
            { tone: "danger" as const, k: "Margin call", v: "70% margin ratio", d: "Strike's level. Locke repeats the alert." },
            { tone: "ink" as const, k: "Liquidation", v: "100% margin ratio", d: "Strike closes the position. Locke tells you at once." },
          ].map((r) => (
            <Card key={r.k} tone={r.tone} className="flex min-h-[200px] flex-col">
              <Eyebrow className={SUBTLE[r.tone]}>{r.v}</Eyebrow>
              <h3 className="display mt-auto pt-8 text-[28px]">{r.k}</h3>
              <p className={`mt-2 text-[14px] ${SUBTLE[r.tone]}`}>{r.d}</p>
            </Card>
          ))}
        </div>
      </section>

      <footer className="flex flex-col gap-4 border-t border-line pt-8 text-[13px] leading-relaxed text-ink-3 !mt-20 sm:flex-row sm:justify-between">
        <p className="max-w-[70ch]">
          Locke is a tool, not financial advice. Hedges can lose money on their own, and positions can be liquidated if margin runs out.
          Strike has eligibility rules; check{" "}
          <a className="underline underline-offset-4" href="https://docs.strikefinance.org" target="_blank" rel="noreferrer">
            Strike&apos;s restricted persons policy
          </a>{" "}
          before you use it.
        </p>
        <p className="num shrink-0">Built on Strike · Cardano</p>
      </footer>
    </div>
  );
}
