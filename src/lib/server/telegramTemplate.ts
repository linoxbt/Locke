// Locke's branded Telegram message: the same content as the email, in Telegram's HTML subset, with
// a coloured status, the plan's facts, and a button to the plan.

import type { EmailContent, EmailTone } from "./emailTemplate";

const STATUS: Record<EmailTone, string> = {
  info: "🔵 Update",
  ok: "🟢 Protected",
  watch: "🟠 Needs attention",
  danger: "🔴 Urgent",
};

/** Telegram's HTML mode needs only these three escaped. */
export const tgEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface TelegramMessage {
  text: string;
  /** One URL button under the message. Telegram only opens https links from buttons. */
  button?: { label: string; url: string };
}

export function renderTelegram(c: EmailContent): TelegramMessage {
  const lines = [
    `<b>LOCKE</b>${c.eyebrow ? ` · ${tgEscape(c.eyebrow)}` : ""}`,
    STATUS[c.tone ?? "info"],
    "",
    `<b>${tgEscape(c.title)}</b>`,
    "",
    ...c.paragraphs.flatMap((p) => [tgEscape(p), ""]),
  ];
  if (c.facts?.length) {
    for (const [k, v] of c.facts) lines.push(`${tgEscape(k)}: ${/^0x/.test(v) ? `<code>${tgEscape(v)}</code>` : `<b>${tgEscape(v)}</b>`}`);
    lines.push("");
  }
  if (c.footnote) lines.push(`<i>${tgEscape(c.footnote)}</i>`);
  const url = c.cta?.url;
  return {
    text: lines.join("\n").trim(),
    button: c.cta && url && url.startsWith("https://") ? { label: `${c.cta.label} →`, url } : undefined,
  };
}
