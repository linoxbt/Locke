// Alerts for whoever runs Locke: a problem is sent once to Telegram and by email, again while it
// lasts (hourly when urgent, every six hours otherwise), and an all-clear when it is gone.
// Channels are optional: with none set, alerts are only logged.

import { db } from "./db";

export interface Alert {
  /** Stable id within its source, e.g. "gas" or "risk:0xabc…". */
  key: string;
  level: "warn" | "urgent";
  title: string;
  detail?: string;
}

const REPEAT_MS = { urgent: 60 * 60_000, warn: 6 * 60 * 60_000 } as const;
const TIMEOUT_MS = 8_000;

const env = (k: string) => process.env[k]?.trim() || undefined;

/** Which channels are set up, for health and logs (never their secrets). */
export function alertChannels(): string[] {
  const out: string[] = [];
  if (env("ALERT_TELEGRAM_BOT_TOKEN") && env("ALERT_TELEGRAM_CHAT_ID")) out.push("telegram");
  if (env("RESEND_API_KEY") && env("ALERT_EMAIL_TO")) out.push("email");
  return out;
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
}

/** Send one message on every channel that is set up; a failing channel doesn't stop the others. */
export async function sendAlertMessage(subject: string, text: string): Promise<string[]> {
  const sent: string[] = [];
  const token = env("ALERT_TELEGRAM_BOT_TOKEN");
  const chat = env("ALERT_TELEGRAM_CHAT_ID");
  const resend = env("RESEND_API_KEY");
  const to = env("ALERT_EMAIL_TO");
  await Promise.all([
    token && chat
      ? post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chat, text: `${subject}\n\n${text}`, disable_web_page_preview: true })
          .then(() => sent.push("telegram"))
          .catch((e) => console.warn(`[alerts] telegram: ${(e as Error).message}`))
      : null,
    resend && to
      ? post(
          "https://api.resend.com/emails",
          { from: env("ALERT_EMAIL_FROM") ?? "Locke alerts <onboarding@resend.dev>", to: to.split(",").map((s) => s.trim()), subject, text },
          { Authorization: `Bearer ${resend}` }
        )
          .then(() => sent.push("email"))
          .catch((e) => console.warn(`[alerts] email: ${(e as Error).message}`))
      : null,
  ]);
  return sent;
}

/**
 * Report what is wrong right now for one source ("keeper", "watch"): new problems are sent,
 * lasting ones repeated on their schedule, and ones no longer reported are sent as resolved.
 * Never throws: alerting must not take down what it watches.
 */
export async function syncAlerts(source: string, active: Alert[]): Promise<void> {
  try {
    const sql = db();
    const rows = (await sql`select key, level, title, last_sent_at, resolved_at from ops_alerts where source = ${source}`) as unknown as {
      key: string;
      level: Alert["level"];
      title: string;
      last_sent_at: Date;
      resolved_at: Date | null;
    }[];
    const known = new Map(rows.map((r) => [r.key, r]));
    const now = Date.now();
    for (const a of active) {
      const r = known.get(a.key);
      const fresh = !r || r.resolved_at != null;
      const escalated = !!r && !fresh && r.level === "warn" && a.level === "urgent";
      if (!fresh && !escalated && now - r!.last_sent_at.getTime() < REPEAT_MS[a.level]) continue;
      const lead = a.level === "urgent" ? "🔴" : "🟠";
      const subject = `${lead} Locke: ${a.title}${fresh || escalated ? "" : " (still)"}`;
      await sendAlertMessage(subject, `${a.detail ?? a.title}\n\nSource: ${source} · ${new Date(now).toISOString()}`);
      await sql`
        insert into ops_alerts (source, key, level, title, first_at, last_sent_at, resolved_at)
        values (${source}, ${a.key}, ${a.level}, ${a.title}, now(), now(), null)
        on conflict (source, key) do update set level = excluded.level, title = excluded.title, last_sent_at = now(), resolved_at = null,
          first_at = case when ops_alerts.resolved_at is null then ops_alerts.first_at else now() end`;
    }
    const still = new Set(active.map((a) => a.key));
    for (const r of rows) {
      if (r.resolved_at != null || still.has(r.key)) continue;
      await sendAlertMessage(`✅ Locke: resolved: ${r.title}`, `This is no longer reported.\n\nSource: ${source} · ${new Date(now).toISOString()}`);
      await sql`update ops_alerts set resolved_at = now() where source = ${source} and key = ${r.key}`;
    }
  } catch (e) {
    console.warn(`[alerts] ${source}: ${(e as Error).message}`);
  }
}
