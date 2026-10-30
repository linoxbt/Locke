import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";
import { contactEmail, operatorName } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy · Locke", description: "What Locke collects, why, and your choices." };

export default function Privacy() {
  return (
    <LegalPage
      path="/legal/privacy"
      title="Privacy Policy"
      lead={
        <>
          Locke is built to need very little about you: no name, no email, no ID documents. You sign in with a wallet. This policy explains
          what {operatorName()} collects when you use Locke, why, who else sees it, and the choices you have.
        </>
      }
    >
      <h2>What we collect</h2>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Wallet addresses: your Cardano payment address (and the stake address derived from it), or your Base address</td>
            <td>To sign you in and show you your plans, vaults and balances</td>
          </tr>
          <tr>
            <td>Your Strike account id and an encrypted trading key for it (Locke on Strike)</td>
            <td>To place, change and close the orders your plans need. The key is encrypted with AES-256-GCM and can&apos;t withdraw</td>
          </tr>
          <tr>
            <td>What you enter in a plan: amounts held, fuel spend, country, currency, leverage and similar</td>
            <td>To size the hedge and show you what it protects</td>
          </tr>
          <tr>
            <td>Plan and vault records: status, positions, prices, margin readings, alerts, deposits and transaction ids</td>
            <td>To run and monitor your protection and show you its history</td>
          </tr>
          <tr>
            <td>Your acknowledgement of the risks before protection opens</td>
            <td>To record that you were told</td>
          </tr>
          <tr>
            <td>
              If you turn on &quot;Protect as you get paid&quot;: the spend permission your Base Account signed (its cap, period and signature),
              and the USDC transfers into that account on Base, which Locke reads to work out your chosen share
            </td>
            <td>To move that share into your vault, never more than your cap. Stops when you turn it off or revoke it</td>
          </tr>
          <tr>
            <td>If you or your agent pay for Locke&apos;s agent API: the paying address and the payment authorization (amount and nonce)</td>
            <td>To take each payment once and settle it on Base</td>
          </tr>
          <tr>
            <td>Your network (the first three parts of an IPv4 address, or an IPv6 /64), kept for about 10 minutes</td>
            <td>To limit sign-in attempts and stop abuse</td>
          </tr>
          <tr>
            <td>Technical logs kept by our hosting providers, which include IP addresses and browser details</td>
            <td>To keep the service running and secure</td>
          </tr>
        </tbody>
      </table>
      <p>
        We don&apos;t collect names, email addresses or identity documents, and we don&apos;t use analytics or advertising trackers. When you
        sign in, your wallet signs a one-time message; we check it and keep only the result.
      </p>

      <h2>Blockchains are public</h2>
      <p>
        Your wallet address, deposits, vault and trades are recorded on public blockchains (Cardano, Base) and in venues&apos; public data.
        Anyone can see them, and nobody, including us, can delete them. If you share a plan link, anyone with that link can see that
        plan&apos;s numbers, read-only.
      </p>

      <h2>Who else sees data</h2>
      <ul>
        <li>
          <strong>Trading venues:</strong> Strike Finance receives your Strike account&apos;s orders through Locke; Avantis (now operating as Veranta) sees your
          vault&apos;s trades on Base. Each uses data under its own privacy policy.
        </li>
        <li>
          <strong>Your browser talks directly to</strong> your wallet, Strike&apos;s price stream (for live plan numbers) and, if you sign in
          with Base Account, Coinbase&apos;s Base Account service. They see your IP address.
        </li>
        <li>
          <strong>Our providers:</strong> hosting (Netlify), database (Supabase), background workers (Railway), and blockchain data and price
          services (such as Koios, Base RPC providers and Pyth through Avantis). They process data only to provide their service to us.
        </li>
        <li>
          <strong>When the law requires it:</strong> to comply with a valid legal request, or to protect users and Locke from fraud or abuse.
        </li>
      </ul>
      <p>We don&apos;t sell your data and we don&apos;t share it for advertising.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Sign-in sessions last 24 hours. Sign-in challenges and network records are deleted within about 10 minutes.</li>
        <li>Minute-by-minute plan snapshots are deleted after 90 days.</li>
        <li>
          Plans, vaults, alerts and deposit records are kept while you use Locke and for as long as we need them for records, disputes or
          the law. You can ask us to delete them sooner (see below).
        </li>
      </ul>

      <h2>Security</h2>
      <p>
        Trading keys are encrypted at rest; sessions use signed, HTTP-only cookies; the database has row-level security and its public access
        roles have no access to tables; requests that change anything must come from Locke&apos;s own site. No system is perfectly secure, but
        a leaked Locke trading key could not move your money out: withdrawals need your own wallet.
      </p>

      <h2>Your rights</h2>
      <p>
        Depending on where you live (for example under the GDPR, the UK GDPR or Nigeria&apos;s Data Protection Act), you can ask us to
        access, correct or delete your data, to restrict or object to how we use it, or to give you a copy. Write to {contactEmail()} with
        the wallet address it concerns; we may ask you to sign a message to show it&apos;s yours. We&apos;ll answer within 30 days. Data on
        public blockchains can&apos;t be deleted. You can also complain to your data protection authority.
      </p>
      <p>
        We rely on: performing our agreement with you (running your plans), our legitimate interests (security, preventing abuse, improving
        Locke), legal obligations, and, for optional browser storage, your consent (see the <Link href="/legal/cookies">Cookie Policy</Link>).
      </p>

      <h2>International transfers</h2>
      <p>
        Our providers may process data outside your country, including in the United States and the European Union. Where the law requires it,
        we rely on safeguards such as standard contractual clauses.
      </p>

      <h2>Children</h2>
      <p>Locke is for businesses and adults. It is not meant for anyone under 18, and we don&apos;t knowingly collect their data.</p>

      <h2>Changes</h2>
      <p>We&apos;ll update this policy when what we collect or how we use it changes. The date at the top shows the current version.</p>
    </LegalPage>
  );
}
