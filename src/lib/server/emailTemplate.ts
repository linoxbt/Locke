// Locke's branded email: one layout for confirmations and alerts. Built for email clients: tables,
// inline styles, a hosted PNG logo (SVG is blocked by many clients), and a plain-text twin.

export type EmailTone = "info" | "ok" | "watch" | "danger";

export interface EmailContent {
  /** Shown after the subject in the inbox list; hidden in the email itself. */
  preheader: string;
  /** Small line above the title, e.g. "NVIDIA stock protection". */
  eyebrow?: string;
  title: string;
  paragraphs: string[];
  /** Label and value rows, e.g. [["Margin used", "62%"]]. */
  facts?: [string, string][];
  cta?: { label: string; url: string };
  /** Print the button's address under it, for links people may need to copy (confirmations). */
  showLink?: boolean;
  tone?: EmailTone;
  /** Why they got it, and how to stop it. */
  footnote?: string;
}

const C = {
  canvas: "#F2F1EE",
  paper: "#FFFFFF",
  mist: "#E8E7E3",
  line: "#DCDBD6",
  ink: "#0C0C0D",
  ink2: "#5D5D62",
  ink3: "#656569",
  cobalt: "#2343FF",
  lime: "#D6F36B",
};
const TONE: Record<EmailTone, { dot: string; label: string }> = {
  info: { dot: C.cobalt, label: "Update" },
  ok: { dot: "#08743F", label: "Protected" },
  watch: { dot: "#FFB020", label: "Needs attention" },
  danger: { dot: "#DC2F18", label: "Urgent" },
};
const SANS = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const DISPLAY = "'Inter Tight', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The public site the email links to and loads its logo from. */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://trylocke.online").replace(/\/$/, "");
}

export function renderEmail(c: EmailContent): { html: string; text: string } {
  const site = siteUrl();
  const tone = TONE[c.tone ?? "info"];
  const facts = (c.facts ?? [])
    .map(
      ([k, v], i) => `
              <tr>
                <td style="padding:12px 0;${i ? `border-top:1px solid ${C.line};` : ""}font:400 14px/20px ${SANS};color:${C.ink2};">${esc(k)}</td>
                <td align="right" style="padding:12px 0;${i ? `border-top:1px solid ${C.line};` : ""}font:500 14px/20px ${SANS};color:${C.ink};">${esc(v)}</td>
              </tr>`
    )
    .join("");
  const paragraphs = c.paragraphs.map((p) => `<p style="margin:0 0 14px;font:400 15px/24px ${SANS};color:${C.ink2};">${esc(p)}</p>`).join("");
  const cta = c.cta
    ? `
          <tr>
            <td class="px" style="padding:10px 40px 4px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td bgcolor="${C.cobalt}" style="border-radius:999px;">
                  <a href="${esc(c.cta.url)}" target="_blank" style="display:inline-block;padding:14px 26px;font:500 15px/20px ${SANS};color:#FFFFFF;text-decoration:none;border-radius:999px;">${esc(c.cta.label)}&nbsp;&rarr;</a>
                </td>
              </tr></table>
            </td>
          </tr>
          ${c.showLink ? `<tr><td class="px" style="padding:14px 40px 0;font:400 12px/18px ${SANS};color:${C.ink3};word-break:break-all;">Button not working? Open <a href="${esc(c.cta.url)}" style="color:${C.ink3};text-decoration:underline;">${esc(c.cta.url.replace(/^https?:\/\//, ""))}</a></td></tr>` : ""}`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${esc(c.title)}</title>
<style>
  @media (max-width: 620px) {
    .px { padding-left: 24px !important; padding-right: 24px !important; }
    .title { font-size: 26px !important; line-height: 32px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.canvas};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(c.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.canvas}" style="background:${C.canvas};">
    <tr>
      <td align="center" style="padding:36px 12px 44px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
          <tr>
            <td class="px" style="padding:0 8px 22px;">
              <a href="${site}" target="_blank" style="text-decoration:none;"><img src="${site}/brand/email/locke-logo@2x.png" width="132" height="34" alt="Locke" style="display:block;border:0;outline:none;width:132px;height:auto;"></a>
            </td>
          </tr>
          <tr>
            <td bgcolor="${C.paper}" style="background:${C.paper};border-radius:20px;border-top:6px solid ${C.ink};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px" style="padding:30px 40px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                      <td style="padding:5px 12px 5px 10px;background:${C.canvas};border-radius:999px;font:500 12px/16px ${SANS};color:${C.ink};">
                        <span style="display:inline-block;width:8px;height:8px;border-radius:8px;background:${tone.dot};vertical-align:middle;margin-right:6px;"></span><span style="vertical-align:middle;">${esc(tone.label)}</span>
                      </td>
                    </tr></table>
                  </td>
                </tr>
                ${c.eyebrow ? `<tr><td class="px" style="padding:22px 40px 0;font:500 12px/16px ${SANS};letter-spacing:0.08em;text-transform:uppercase;color:${C.ink3};">${esc(c.eyebrow)}</td></tr>` : ""}
                <tr>
                  <td class="px title" style="padding:${c.eyebrow ? "8px" : "22px"} 40px 16px;font:500 30px/36px ${DISPLAY};letter-spacing:-0.02em;color:${C.ink};">${esc(c.title)}</td>
                </tr>
                <tr><td class="px" style="padding:0 40px 6px;">${paragraphs}</td></tr>
                ${
                  facts
                    ? `<tr><td class="px" style="padding:4px 40px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.canvas};border-radius:14px;"><tr><td style="padding:4px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${facts}</table></td></tr></table></td></tr>`
                    : ""
                }
                ${cta}
                <tr><td style="height:36px;line-height:36px;font-size:0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:24px 8px 0;font:400 12px/19px ${SANS};color:${C.ink3};">
              ${c.footnote ? `<p style="margin:0 0 12px;">${esc(c.footnote)}</p>` : ""}
              <p style="margin:0 0 12px;"><strong style="font-weight:500;color:${C.ink};">Locke</strong> &middot; Price protection for businesses, on Base.</p>
              <p style="margin:0;">
                <a href="${site}/account" style="color:${C.ink3};text-decoration:underline;">Manage alerts</a>
                &nbsp;&middot;&nbsp;<a href="${site}/legal/terms" style="color:${C.ink3};text-decoration:underline;">Terms</a>
                &nbsp;&middot;&nbsp;<a href="${site}/legal/privacy" style="color:${C.ink3};text-decoration:underline;">Privacy</a>
                &nbsp;&middot;&nbsp;<a href="${site}/legal/risk" style="color:${C.ink3};text-decoration:underline;">Risk disclosure</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    c.eyebrow ? c.eyebrow.toUpperCase() : null,
    c.title,
    "",
    ...c.paragraphs.flatMap((p) => [p, ""]),
    ...(c.facts?.length ? [...c.facts.map(([k, v]) => `${k}: ${v}`), ""] : []),
    c.cta ? `${c.cta.label}: ${c.cta.url}` : null,
    "",
    "—",
    c.footnote ?? null,
    `Locke · Price protection for businesses, on Base. Manage alerts: ${site}/account`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  return { html, text };
}
