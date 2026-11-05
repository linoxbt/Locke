// Alerts for each business about its own plans: a Telegram chat linked through Locke's bot, and an
// email address it confirmed. Linking uses single-use tokens, stored hashed, that expire.

import { createHash, randomBytes } from "node:crypto";
import { baseMarket } from "../base/contracts";
import { db } from "./db";
import { renderEmail, siteUrl, type EmailContent, type EmailTone } from "./emailTemplate";
import { HttpError } from "./errors";

const LINK_TTL_MIN = 15;
const EMAIL_TTL_H = 24;
/** At most one confirmation email per address this often, so the form can't be used to spam. */
const EMAIL_EVERY_S = 60;
const TIMEOUT_MS = 8_000;

const env = (k: string) => process.env[k]?.trim() || undefined;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const token = () => randomBytes(18).toString("base64url");

export interface AlertSettings {
  telegram: { linked: boolean; username: string | null; available: boolean };
  email: { address: string | null; verified: boolean; pending: boolean; available: boolean };
}

/** The bot's handle (without @), for links to it. */
export const telegramBot = () => env("TELEGRAM_BOT_USERNAME") ?? "trylockebot";
const telegramReady = () => !!env("ALERT_TELEGRAM_BOT_TOKEN");
/** Email to businesses needs a sender on a domain verified with Resend (onboarding@resend.dev only reaches Locke's own inbox). */
const emailReady = () => !!env("RESEND_API_KEY") && !!env("USER_EMAIL_FROM");

export async function alertSettings(uid: string): Promise<AlertSettings> {
  const [r] = await db()`select * from base_user_alerts where user_id = ${uid}`;
  return {
    telegram: { linked: !!r?.telegram_chat_id, username: r?.telegram_username ?? null, available: telegramReady() },
    email: {
      address: r?.email ?? null,
      verified: !!r?.email_verified_at,
      pending: !!r?.email && !r?.email_verified_at && !!r?.email_token_expires && new Date(r.email_token_expires) > new Date(),
      available: emailReady(),
    },
  };
}

// ---------------------------------------------------------------- telegram

/** A one-time link that opens Locke's bot; pressing Start in it links that chat to this account. */
export async function telegramLink(uid: string): Promise<string> {
  if (!telegramReady()) throw new HttpError(503, "Telegram alerts aren't set up yet.");
  const t = token();
  await db()`
    insert into base_user_alerts (user_id, telegram_token, telegram_token_expires)
    values (${uid}, ${hash(t)}, now() + make_interval(mins => ${LINK_TTL_MIN}))
    on conflict (user_id) do update set telegram_token = excluded.telegram_token, telegram_token_expires = excluded.telegram_token_expires, updated_at = now()`;
  return `https://t.me/${telegramBot()}?start=${t}`;
}

export async function unlinkTelegram(uid: string) {
  const [r] = await db()`select telegram_chat_id from base_user_alerts where user_id = ${uid}`;
  await db()`update base_user_alerts set telegram_chat_id = null, telegram_username = null, telegram_token = null, updated_at = now() where user_id = ${uid}`;
  if (r?.telegram_chat_id) await telegramSend(String(r.telegram_chat_id), "This chat no longer gets Locke alerts. Link it again from your Locke account any time.").catch(() => null);
}

export async function telegramSend(chatId: string, text: string): Promise<void> {
  const bot = env("ALERT_TELEGRAM_BOT_TOKEN");
  if (!bot) throw new Error("Telegram isn't set up");
  const res = await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Telegram answered ${res.status}`);
}

interface TelegramUpdate {
  message?: { text?: string; chat?: { id?: number; type?: string }; from?: { username?: string } };
}

/** One update from Telegram's webhook: /start <token> links the chat, /stop unlinks it. */
export async function telegramUpdate(u: TelegramUpdate): Promise<void> {
  const m = u.message;
  const chat = m?.chat?.id;
  if (!m || chat == null || m.chat?.type !== "private") return;
  const text = (m.text ?? "").trim();
  const chatId = String(chat);
  const site = siteUrl();
  if (text.startsWith("/start")) {
    const t = text.split(/\s+/)[1];
    if (!t) return telegramSend(chatId, `Hi. To get alerts about your Locke plans here, open your account on ${site}/account and choose Link Telegram.`);
    const [r] = await db()`
      update base_user_alerts set telegram_chat_id = ${chatId}, telegram_username = ${m.from?.username ?? null}, telegram_token = null,
        telegram_token_expires = null, updated_at = now()
      where telegram_token = ${hash(t)} and telegram_token_expires > now()
      returning user_id`;
    if (!r) return telegramSend(chatId, `That link has expired or was already used. Make a new one from ${site}/account.`);
    // One chat follows one account: linking here moves it off any other.
    await db()`update base_user_alerts set telegram_chat_id = null, telegram_username = null where telegram_chat_id = ${chatId} and user_id <> ${r.user_id}`;
    const [u2] = await db()`select address from base_users where id = ${r.user_id}`;
    const who = u2 ? `${String(u2.address).slice(0, 6)}…${String(u2.address).slice(-4)}` : "your account";
    return telegramSend(chatId, `Linked to Locke (${who}). You'll get alerts about your plans here: when a hedge opens or closes, when margin runs thin and when a plan needs money. Send /stop to turn them off.`);
  }
  if (text === "/stop") {
    const rows = await db()`update base_user_alerts set telegram_chat_id = null, telegram_username = null, updated_at = now() where telegram_chat_id = ${chatId} returning user_id`;
    return telegramSend(chatId, rows.length ? "Done: this chat no longer gets Locke alerts." : "This chat isn't linked to a Locke account.");
  }
  return telegramSend(chatId, `This bot sends alerts about your Locke plans. Link it from ${site}/account. Send /stop to turn alerts off.`);
}

// ---------------------------------------------------------------- email

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

async function sendEmail(to: string, subject: string, content: EmailContent): Promise<void> {
  const key = env("RESEND_API_KEY");
  const from = env("USER_EMAIL_FROM");
  if (!key || !from) throw new Error("Email isn't set up");
  const { html, text } = renderEmail(content);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to: [to], subject, html, text, headers: { "List-Unsubscribe": `<${siteUrl()}/account>` } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Resend answered ${res.status}`);
}

/** Save the address and send it a confirmation link; alerts go there once it's confirmed. */
export async function startEmail(uid: string, raw: unknown, origin: string): Promise<void> {
  if (!emailReady()) throw new HttpError(503, "Email alerts aren't set up yet.");
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) throw new HttpError(400, "Enter a valid email address.");
  const [prev] = await db()`select email_sent_at from base_user_alerts where user_id = ${uid}`;
  if (prev?.email_sent_at && Date.now() - new Date(prev.email_sent_at).getTime() < EMAIL_EVERY_S * 1000) {
    throw new HttpError(429, "A confirmation email was just sent. Wait a minute before asking for another.");
  }
  const t = token();
  await db()`
    insert into base_user_alerts (user_id, email, email_verified_at, email_token, email_token_expires, email_sent_at)
    values (${uid}, ${email}, null, ${hash(t)}, now() + make_interval(hours => ${EMAIL_TTL_H}), now())
    on conflict (user_id) do update set email = excluded.email, email_verified_at = null, email_token = excluded.email_token,
      email_token_expires = excluded.email_token_expires, email_sent_at = now(), updated_at = now()`;
  const link = `${origin}/api/base/alerts/email/confirm?t=${t}`;
  await sendEmail(email, "Confirm your email for Locke alerts", {
    preheader: "One click and alerts about your plans come here.",
    eyebrow: "Email alerts",
    title: "Confirm your email",
    paragraphs: [
      "Confirm this address and Locke emails you about your protection plans: when a hedge opens or closes, when margin runs thin, and when a plan needs money.",
      "Nothing else is sent, and you can turn alerts off in your account at any time.",
    ],
    cta: { label: "Confirm email", url: link },
    showLink: true,
    footnote: `The link works for ${EMAIL_TTL_H} hours. If you didn't ask for this, ignore this email: nothing changes.`,
  }).catch(async (e) => {
    await db()`update base_user_alerts set email_sent_at = null where user_id = ${uid}`;
    console.warn(`[user-alerts] confirmation email: ${(e as Error).message}`);
    throw new HttpError(502, "Locke couldn't send the confirmation email. Try again shortly.");
  });
}

/** The confirmation link: true when it confirmed an address. */
export async function confirmEmail(t: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(t)) return false;
  const rows = await db()`
    update base_user_alerts set email_verified_at = now(), email_token = null, email_token_expires = null, updated_at = now()
    where email_token = ${hash(t)} and email_token_expires > now() returning user_id`;
  return rows.length > 0;
}

export async function removeEmail(uid: string) {
  await db()`update base_user_alerts set email = null, email_verified_at = null, email_token = null, email_token_expires = null, updated_at = now() where user_id = ${uid}`;
}

// ---------------------------------------------------------------- sending

const ALERT_FOOTNOTE = "You get this because you turned on email alerts in your Locke account.";

/** Send one message to every channel this account has linked: Telegram gets the text, email the branded layout. Never throws. */
export async function notifyUser(uid: string, subject: string, text: string, email?: EmailContent): Promise<string[]> {
  const sent: string[] = [];
  try {
    const [r] = await db()`select email, email_verified_at, telegram_chat_id from base_user_alerts where user_id = ${uid}`;
    if (!r) return sent;
    await Promise.all([
      r.telegram_chat_id && telegramReady()
        ? telegramSend(String(r.telegram_chat_id), `${subject}\n\n${text}`)
            .then(() => sent.push("telegram"))
            .catch((e) => console.warn(`[user-alerts] telegram: ${(e as Error).message}`))
        : null,
      r.email && r.email_verified_at && emailReady()
        ? sendEmail(String(r.email), subject, email ?? { preheader: text.slice(0, 90), title: subject, paragraphs: [text], footnote: ALERT_FOOTNOTE })
            .then(() => sent.push("email"))
            .catch((e) => console.warn(`[user-alerts] email: ${(e as Error).message}`))
        : null,
    ]);
  } catch (e) {
    console.warn(`[user-alerts] ${(e as Error).message}`);
  }
  return sent;
}

/** Tell a vault's owner something about that plan, with a link to it. */
export async function notifyVaultOwner(vault: string, headline: string, text: string, tone: EmailTone = "info"): Promise<void> {
  try {
    const [v] = await db()`select user_id, pair_index, name from base_vaults where address = ${vault.toLowerCase()}`;
    if (!v?.user_id) return;
    const m = baseMarket(Number(v.pair_index));
    const plan = String(v.name ?? m?.label ?? "Your plan");
    const url = `${siteUrl()}/plans/${vault.toLowerCase()}`;
    const title = headline.charAt(0).toUpperCase() + headline.slice(1);
    await notifyUser(String(v.user_id), `Locke · ${plan}: ${headline}`, `${text}\n\n${url}`, {
      preheader: text.slice(0, 110),
      eyebrow: plan,
      title,
      paragraphs: [text],
      facts: [
        ["Plan", plan],
        ...(m ? ([["Hedged on Veranta", m.symbol]] as [string, string][]) : []),
        ["Vault", `${vault.slice(0, 6)}…${vault.slice(-4)}`],
      ],
      cta: { label: "View plan", url },
      tone,
      footnote: ALERT_FOOTNOTE,
    });
  } catch (e) {
    console.warn(`[user-alerts] ${(e as Error).message}`);
  }
}
