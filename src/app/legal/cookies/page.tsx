import type { Metadata } from "next";
import Link from "next/link";
import { CookieSettingsLink } from "@/components/CookieConsent";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Cookie Policy · Locke", description: "The cookies and browser storage Locke uses." };

const NECESSARY: [string, string, string, string][] = [
  ["__Host-locke_session", "Cookie", "Keeps you signed in to Locke on Strike", "24 hours"],
  ["__Host-locke_base", "Cookie", "Keeps you signed in to Locke on Base", "24 hours"],
  ["locke_consent", "Cookie", "Remembers your cookie choice", "12 months"],
  ["locke.pendingDeposits", "Local storage", "Holds a deposit you sent until Locke has confirmed it, so it isn't lost if you close the tab", "Until the deposit is confirmed"],
  ["locke.base.wallet", "Session storage", "Which wallet you signed in to Locke on Base with, so your transactions go to it", "Until you close the tab"],
];

const PREFERENCES: [string, string, string, string][] = [
  ["locke.wallet", "Local storage", "Which Cardano wallet you used, so it reconnects on your next visit", "Until you sign out or clear it"],
  ["locke.base.wallet", "Local storage", "Which wallet you used on Locke on Base, across visits", "Until you sign out or clear it"],
];

function Table({ rows }: { rows: [string, string, string, string][] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Purpose</th>
          <th>Kept for</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, type, purpose, kept]) => (
          <tr key={name + type}>
            <td>
              <code>{name}</code>
            </td>
            <td>{type}</td>
            <td>{purpose}</td>
            <td>{kept}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Cookies() {
  return (
    <LegalPage
      path="/legal/cookies"
      title="Cookie Policy"
      lead={
        <>
          Cookies and browser storage are small pieces of data a site keeps in your browser. Locke uses them only to keep you signed in, to
          finish what you started, and, if you agree, to remember your wallet. Locke uses no analytics and no advertising cookies, and no
          third-party trackers.
        </>
      }
    >
      <h2>Strictly necessary</h2>
      <p>These make Locke work. They don&apos;t need your consent, and switching them off in your browser stops sign-in from working.</p>
      <Table rows={NECESSARY} />

      <h2>Preferences (optional)</h2>
      <p>Only with your consent. If you say no, Locke asks you to pick your wallet again each visit.</p>
      <Table rows={PREFERENCES} />

      <h2>Analytics and advertising</h2>
      <p>None. If that ever changes, they will stay off until you agree to them here.</p>

      <h2>Other services in the page</h2>
      <p>
        When you use a wallet, it may keep its own data in your browser under its own policy. If you sign in with Base Account, Coinbase&apos;s
        Base Account service keeps the data it needs to connect your account, under Coinbase&apos;s privacy policy. Locke doesn&apos;t control
        or read that data.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>
          Change your choice at any time: <CookieSettingsLink className="text-cobalt underline underline-offset-2" />.
        </li>
        <li>You can also block or delete cookies and site data in your browser&apos;s settings.</li>
      </ul>
      <p>
        More about what Locke collects is in the <Link href="/legal/privacy">Privacy Policy</Link>.
      </p>
    </LegalPage>
  );
}
