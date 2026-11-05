"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, ErrorNote, inputCls, Notice } from "../ui";

interface Settings {
  telegram: { linked: boolean; username: string | null; available: boolean };
  email: { address: string | null; verified: boolean; pending: boolean; available: boolean };
}

async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Where this business hears about its plans: Telegram and email, each linked from here. */
export function AlertsCard({ confirmed }: { confirmed?: "confirmed" | "expired" | null }) {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [waitingTg, setWaitingTg] = useState(false);
  const [tested, setTested] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const next = await call<Settings>("/api/base/alerts", "GET");
    setS(next);
    return next;
  }, []);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, [load]);

  const act = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what);
    setError(null);
    setTested(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const linkTelegram = () =>
    act("tg", async () => {
      const { url } = await call<{ url: string }>("/api/base/alerts/telegram", "POST");
      window.open(url, "_blank", "noopener");
      setWaitingTg(true);
      // Linked once Start is pressed in the bot; stop looking after the link expires.
      const until = Date.now() + 15 * 60_000;
      if (poll.current) clearInterval(poll.current);
      poll.current = setInterval(async () => {
        const next = await load().catch(() => null);
        if (next?.telegram.linked || Date.now() > until) {
          if (poll.current) clearInterval(poll.current);
          setWaitingTg(false);
        }
      }, 3000);
    });

  const unlinkTelegram = () => act("tg-off", async () => (await call("/api/base/alerts/telegram", "DELETE"), load()));
  const saveEmail = () =>
    act("email", async () => {
      await call("/api/base/alerts/email", "POST", { email });
      setSentTo(email.trim().toLowerCase());
      await load();
    });
  const removeEmail = () => act("email-off", async () => (await call("/api/base/alerts/email", "DELETE"), setSentTo(null), setEmail(""), load()));
  const test = () =>
    act("test", async () => {
      const { sent } = await call<{ sent: string[] }>("/api/base/alerts/test", "POST");
      setTested(`Test sent to ${sent.map((c) => (c === "telegram" ? "Telegram" : "email")).join(" and ")}.`);
    });

  const anyLinked = !!s && (s.telegram.linked || s.email.verified);

  return (
    <Card className="lg:col-span-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="display text-[17px]">Alerts</h2>
        <p className="text-[13px] text-ink-2">When a hedge opens or closes, when margin runs thin, and when a plan needs money.</p>
      </div>

      {confirmed === "confirmed" && (
        <div className="mt-5">
          <Notice tone="info">Your email is confirmed. Alerts about your plans will arrive there.</Notice>
        </div>
      )}
      {confirmed === "expired" && (
        <div className="mt-5">
          <Notice tone="watch">That confirmation link has expired or was already used. Send a new one below.</Notice>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <section aria-labelledby="alerts-tg" className="flex flex-col gap-3 rounded-2xl bg-canvas p-5">
          <h3 id="alerts-tg" className="text-[15px] font-medium">
            Telegram
          </h3>
          {!s ? (
            <p className="text-[13px] text-ink-3">Loading…</p>
          ) : !s.telegram.available ? (
            <p className="text-[13px] text-ink-2">Telegram alerts aren&apos;t available yet.</p>
          ) : s.telegram.linked ? (
            <>
              <p className="text-[13px] text-ink-2">
                Linked{s.telegram.username ? <> to <span className="text-ink">@{s.telegram.username}</span></> : null}. Send /stop to the bot, or unlink here, to turn it off.
              </p>
              <Button variant="ghost" className="self-start" onClick={unlinkTelegram} busy={busy === "tg-off"}>
                Unlink Telegram
              </Button>
            </>
          ) : (
            <>
              <p className="text-[13px] text-ink-2">
                Opens Locke&apos;s bot in Telegram. Press <span className="text-ink">Start</span> there and this account is linked.
              </p>
              <Button className="self-start" onClick={linkTelegram} busy={busy === "tg"}>
                Link Telegram
              </Button>
              {waitingTg && <p className="text-[12px] text-ink-3">Waiting for you to press Start in Telegram…</p>}
            </>
          )}
        </section>

        <section aria-labelledby="alerts-email" className="flex flex-col gap-3 rounded-2xl bg-canvas p-5">
          <h3 id="alerts-email" className="text-[15px] font-medium">
            Email
          </h3>
          {!s ? (
            <p className="text-[13px] text-ink-3">Loading…</p>
          ) : !s.email.available ? (
            <p className="text-[13px] text-ink-2">Email alerts aren&apos;t available yet. Telegram works now.</p>
          ) : s.email.verified ? (
            <>
              <p className="text-[13px] text-ink-2">
                Alerts go to <span className="text-ink">{s.email.address}</span>.
              </p>
              <Button variant="ghost" className="self-start" onClick={removeEmail} busy={busy === "email-off"}>
                Stop email alerts
              </Button>
            </>
          ) : (
            <>
              {s.email.pending || sentTo ? (
                <p className="text-[13px] text-ink-2">
                  We sent a confirmation link to <span className="text-ink">{sentTo ?? s.email.address}</span>. Open it to turn email alerts on.
                </p>
              ) : (
                <p className="text-[13px] text-ink-2">We send one email to confirm the address. Nothing else is sent until you confirm.</p>
              )}
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveEmail();
                }}
              >
                <label htmlFor="alerts-email-input" className="sr-only">
                  Email address for alerts
                </label>
                <input
                  id="alerts-email-input"
                  className={inputCls}
                  type="email"
                  autoComplete="email"
                  placeholder="you@business.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Button type="submit" className="shrink-0" busy={busy === "email"} disabled={!email.trim()}>
                  {s.email.pending || sentTo ? "Send again" : "Send link"}
                </Button>
              </form>
            </>
          )}
        </section>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {anyLinked && (
          <Button variant="ghost" onClick={test} busy={busy === "test"}>
            Send a test alert
          </Button>
        )}
        {tested && (
          <p role="status" className="text-[13px] text-ink-2">
            {tested}
          </p>
        )}
      </div>
      <div className="mt-3">
        <ErrorNote error={error} />
      </div>
    </Card>
  );
}
