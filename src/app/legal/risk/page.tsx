import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Risk Disclosure · Locke", description: "The risks of hedging with Locke, in plain words." };

export default function Risk() {
  return (
    <LegalPage
      path="/legal/risk"
      title="Risk Disclosure"
      lead={
        <>
          A Locke vault holds a leveraged position in perpetual futures, opened to offset a price move in something your business holds or buys.
          It reduces one risk and adds others. Read this before you protect anything, and only put in money your business can afford to lose.
        </>
      }
    >
      <h2>You can lose the margin</h2>
      <p>
        If the price moves against the hedge, its margin shrinks. When it runs out, the venue closes the position (a liquidation) and the
        margin is gone. That can happen fast in a sharp move.
      </p>
      <p>
        On Veranta, a position is liquidated when its losses and fees reach 85% of its margin. Your plan page shows this as
        &ldquo;margin used&rdquo;, where 100% is liquidation. Locke&apos;s keeper adds margin from your vault&apos;s buffer when it reaches
        60% (by then losses and fees have taken about three quarters of the margin), but only while there is buffer left, the plan&apos;s
        limit has room and the market is open.
      </p>
      <p>Higher leverage needs less money up front and puts liquidation closer. Locke caps leverage at 3x, and lower is safer.</p>

      <h2>Stock plans</h2>
      <p>
        A stock plan sells a perpetual future on Veranta that follows a stock or index price. It is a contract on the price only: it is not a
        share, carries no voting or dividend rights, and Locke never buys, sells or holds stocks for you. Veranta&apos;s stock markets follow
        US trading hours. While they are closed, Locke&apos;s keeper cannot add margin, and prices can open far from where they closed after a
        weekend, a holiday or company news, which can use up the margin before the keeper can act. Stock plans therefore keep a larger
        buffer. Where Locke shows tokenized stocks from your account on Base, it only reads them to size the plan; whether you may hold
        them is a matter between you and their issuer.
      </p>

      <h2>A hedge is not a perfect match</h2>
      <ul>
        <li>
          <strong>Fuel and crude:</strong> pump prices follow crude only in part, and with a delay; taxes, subsidies, margins, transport and
          exchange rates move on their own. A crude hedge can gain while your fuel bill still rises, or the other way round.
        </li>
        <li>
          <strong>Currency:</strong> hedges settle in US dollars (USDC on Base). If your costs are in another currency,
          exchange-rate moves change what the protection is worth to you.
        </li>
        <li>
          <strong>Holdings:</strong> a short hedge gives up gains: if the price rises, the hedge loses about what your holdings gain.
        </li>
      </ul>

      <h2>Holding costs</h2>
      <p>
        Perpetual futures charge or pay funding, and some markets charge a borrow fee. Rates change every hour and can turn against you; over
        months they can add up to a meaningful cost. Opening and closing also pay trading fees and spreads, and Locke&apos;s fee where one
        applies.
      </p>

      <h2>Markets close and roll</h2>
      <p>
        Crypto markets trade around the clock, but oil markets close at night and at weekends. While a market is closed, nobody can add
        margin, resize or close the hedge, and prices can gap when it reopens. Oil hedges on Veranta follow a futures contract that is rolled
        each month: the entry price shifts at the roll and trading pauses briefly.
      </p>

      <h2>Venue and counterparty risk</h2>
      <ul>
        <li>
          Veranta is an independent platform. It can change its rules, fees, margin levels or markets, pause trading, delist a market, or
          fail. Veranta pays winning positions from a liquidity vault, and its contracts can be upgraded by its operators.
        </li>
        <li>Venues depend on price oracles. A wrong or late price can cause a liquidation or a bad fill.</li>
      </ul>

      <h2>Smart contract and software risk</h2>
      <p>
        Locke&apos;s vault contracts are tested extensively but not yet audited by an outside firm, and launch with deposit limits.
        Locke&apos;s servers, the venues&apos; software and wallets can all have bugs or outages. Monitoring and automatic top-ups are best
        effort: they can be late or not happen at all.
      </p>

      <h2>Deposits and networks</h2>
      <p>
        Moving money takes time: a transaction on Base usually confirms in seconds, but network congestion can delay a deposit, a top-up or a close when it matters most. Blockchain transactions are final.
      </p>

      <h2>Your wallet</h2>
      <p>Anyone who controls your wallet controls your plans and your money. Keep it and its recovery phrase safe; Locke can&apos;t recover them.</p>

      <h2>Law and tax</h2>
      <p>
        Derivatives are regulated differently from country to country, and in some places using them may be restricted for you or your
        business. Hedges can have tax and accounting consequences. Check both before you use Locke.
      </p>

      <h2>Not advice</h2>
      <p>
        Locke&apos;s numbers, scenarios and labels are estimates from your inputs and market data, not advice or a promise of any outcome. If
        you&apos;re unsure whether hedging suits your business, talk to a qualified adviser.
      </p>
    </LegalPage>
  );
}
