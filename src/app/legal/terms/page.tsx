import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";
import { contactEmail, governingLaw, LEGAL, operatorName } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Service · Locke", description: "The terms for using Locke." };

export default function Terms() {
  return (
    <LegalPage
      path="/legal/terms"
      title="Terms of Service"
      lead={
        <>
          These terms are the agreement between you and {operatorName()} (&ldquo;Locke&rdquo;, &ldquo;we&rdquo;) for using {LEGAL.site} and
          its apps. By connecting a wallet or creating a plan or vault, you accept them. If you use Locke for a business, you accept them for
          that business and confirm you may do so.
        </>
      }
    >
      <h2>1. What Locke is</h2>
      <p>
        Locke is software that helps a business protect what it holds or buys against price moves. It sizes a hedge, opens it on a
        third-party trading venue from your own account, watches it and tells you when it needs attention. There are two versions:
      </p>
      <ul>
        <li>
          <strong>Locke on Strike</strong> (Cardano): hedges on Strike Finance, from your own Strike account.
        </li>
        <li>
          <strong>Locke on Base</strong>: hedges on Veranta (formerly Avantis), from a vault contract on Base that you own.
        </li>
      </ul>
      <p>
        Locke is a tool, not a broker, bank, exchange, fund, insurer or investment adviser. It does not give financial, legal or tax advice,
        and nothing it shows is a recommendation to buy, sell or hold anything. A hedge is not insurance: it can lose money on its own.
      </p>

      <h2>2. Your money stays yours</h2>
      <ul>
        <li>
          <strong>On Strike</strong>, your funds sit in your own Strike account. When you connect, Locke creates a trading key for your
          account, encrypts it, and uses it only to place, change and close the orders your plans need. That key cannot withdraw:
          withdrawals need your own wallet&apos;s signature and only go to your connected wallet.
        </li>
        <li>
          <strong>On Base</strong>, your USDC sits in a vault contract that your wallet owns. Locke&apos;s keeper can trade it only within
          the limits written into the vault (market, side, leverage and size), and can never withdraw. You can withdraw, close the hedge or
          remove Locke&apos;s keeper from your wallet at any time, without Locke.
        </li>
      </ul>
      <p>We never hold your private keys or seed phrase, and we will never ask for them.</p>

      <h2>3. Who can use Locke</h2>
      <ul>
        <li>You must be at least 18 and able to enter a binding contract.</li>
        <li>
          You must not use Locke where the law forbids it, where Strike or Veranta does not allow you to use its service, or if you are
          subject to sanctions. You are responsible for checking the rules that apply to you.
        </li>
        <li>You must not use Locke to break the law, to move the proceeds of crime, or to interfere with Locke, Strike, Veranta or any network.</li>
      </ul>

      <h2>4. Risk</h2>
      <p>
        Hedging with leveraged perpetual futures carries real risk, including losing the margin you put in. Read the{" "}
        <Link href="/legal/risk">Risk Disclosure</Link> before you create a plan or vault. Locke asks you to confirm that you understand the
        risks before it opens protection.
      </p>

      <h2>5. What Locke does and doesn&apos;t do for you</h2>
      <ul>
        <li>
          Locke calculates sizes, margin and alert levels from the numbers you give it and from market data. Check your inputs: a wrong amount
          gives a wrong hedge.
        </li>
        <li>
          Locke watches open plans and, where you have set it up, adds margin from your buffer when a hedge runs low. It does this on a best
          effort basis. Monitoring can be late or fail (for example when a venue, a network, a price feed or our servers are down), and a
          position can be liquidated before Locke acts.
        </li>
        <li>Locke does not guarantee any outcome, price, fill, or that a hedge will offset a loss elsewhere.</li>
        <li>
          Anyone you give a plan&apos;s share link to can see that plan&apos;s numbers, read-only. Share it only with people you want to see
          them.
        </li>
      </ul>

      <h2>6. Fees</h2>
      <ul>
        <li>
          <strong>On Strike</strong>, Locke earns a builder fee on the orders it places for you, of at most 0.20% of each order&apos;s value.
          The rate is shown when you connect, and orders never carry more than you agreed to.
        </li>
        <li>
          <strong>On Base</strong>, a vault can carry a Locke fee of at most 0.20% of the value of each hedge the keeper opens. The rate is
          fixed when you create the vault and shown before you do.
        </li>
        <li>
          Venues and networks charge their own fees: trading fees, funding and borrow costs, spreads and network fees. Locke shows its best
          estimate of them, but they are set by those services.
        </li>
      </ul>

      <h2>7. Third-party services</h2>
      <p>
        Locke works on top of services we don&apos;t control, including Strike Finance, Veranta, the Cardano and Base networks, price oracles
        (Pyth), wallets (including Base Account by Coinbase), and our hosting and data providers. Your use of them is governed by their own
        terms. We are not responsible for their availability, their decisions (such as liquidations, delistings or account restrictions), or
        losses they cause.
      </p>

      <h2>8. Smart contracts and software</h2>
      <p>
        Locke&apos;s vault contracts on Base are tested extensively but have not yet been audited by an outside firm, and vaults launch with
        deposit limits. Software, including ours and the venues&apos;, can contain bugs. Blockchain transactions are final: we cannot reverse
        them.
      </p>

      <h2>9. Your responsibilities</h2>
      <ul>
        <li>Keep your wallet, devices and recovery phrase secure. Anyone with access to your wallet can act as you.</li>
        <li>Check what your wallet asks you to sign before you sign it.</li>
        <li>Keep records and pay any taxes that apply to your hedges and your business.</li>
      </ul>

      <h2>10. Availability and changes</h2>
      <p>
        We may change, pause or stop any part of Locke, including pausing new plans, deposits or hedges to protect users. A pause never stops
        you from withdrawing or closing: on Base those work from your own wallet; on Strike, from Strike directly. We may update these terms;
        the date at the top shows the current version, and we will flag material changes in the app. Continuing to use Locke after a change
        means you accept it.
      </p>

      <h2>11. Liability</h2>
      <p>
        Locke is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the fullest extent the law allows, we make no warranties,
        and we are not liable for indirect or consequential losses, lost profits, trading losses, liquidations, or losses caused by third-party
        services, networks or events outside our control. Where the law does not allow us to exclude liability, our total liability to you is
        limited to the fees you paid Locke in the three months before the claim. Nothing in these terms limits liability that cannot be
        limited by law.
      </p>

      <h2>12. Ending use</h2>
      <p>
        You can stop using Locke at any time: close your hedges and withdraw. We may suspend or end your access if you break these terms or
        the law. Your funds remain yours and reachable as described in section 2.
      </p>

      <h2>13. Law and disputes</h2>
      <p>
        These terms are governed by the laws of {governingLaw()}, and its courts hear any dispute, unless the law where you live gives you the
        right to bring a claim there. Before going to court, please write to us at {contactEmail()} so we can try to resolve it.
      </p>

      <h2>14. Contact</h2>
      <p>
        {operatorName()} · {contactEmail()}
      </p>
    </LegalPage>
  );
}
