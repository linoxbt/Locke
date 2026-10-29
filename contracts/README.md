# Locke on Base: vault contracts

Each business gets a `LockeVault` on Base. The vault holds the business's USDC and is the trader on
[Veranta](https://www.veranta.xyz) (Avantis until September 2026), so every payout lands back in the
vault. Locke's keeper can steer the hedge within the owner's plan limits; it can never move funds.

| Role | Can | Can never |
| --- | --- | --- |
| Owner (the business's wallet) | Deposit, withdraw idle USDC, close any hedge, add or remove margin, set plan limits, replace or remove the keeper | n/a |
| Keeper (Locke's server) | `hedgeOpen` within the plan (market, side, max leverage, max notional, one position per market), `hedgeClose`, `topUpMargin` | Withdraw, change limits, remove margin |
| Guardian (Locke multisig) | Pause new deposits and new hedges | Block withdrawals, closes or top-ups |

`LockeVaultFactory.createVault(plan, deposit)` deploys a clone owned by the caller, sets its first plan
and funds it in one transaction. Vaults are not upgradeable.

## Run

```bash
cd contracts
npm install
npx hardhat test                                       # offline unit tests (mock Veranta)
FORK=1 npx hardhat test test/fork.veranta.test.ts      # against the real Veranta contracts on a Base fork
node scripts/measure-fills.mjs                         # how fast Veranta fills directly-sent orders
node scripts/measure-funding.mjs                       # which side pays ETH/BTC funding right now
node scripts/testnet-run.mjs <keys.json> [out.json]    # live run on Veranta's test network (needs test funds)
```

The fork test makes a test account a Veranta operator (impersonating Veranta's governance on the fork)
and fills each vault order with a signed Pyth Lazer price from `feed-v3.veranta.xyz`, the same data
Veranta's operators post. Set `BASE_RPC_URL` to use another Base RPC.

## Week 1 results (29 Oct 2026)

- **A vault trades on Veranta.** On a Base mainnet fork against the live contracts, the vault opened a
  WTI long ($20 at 2x, filled at 101.11) and an ETH short ($50 at 2x, filled at 2,325.16), topped up
  WTI margin from $20 to $25 in one transaction, refused orders outside the plan, kept working while
  paused, closed WTI through the keeper (proceeds back in the vault), let the owner remove the keeper
  and close ETH alone, and returned 399.97 of 400 USDC to the owner.
- **Fills are fast.** Over 60,000 recent Base blocks (about 33 hours), Veranta filled all 771 orders
  sent straight to its contracts: half within 1 block (about 2 seconds), 90% within 2, none slower
  than 3. That includes 16 orders from contract traders. The other 5,862 orders came through its
  relayer and filled in the same transaction.
- **ETH and BTC funding flows from longs to shorts right now.** In 40 live positions, all 20 longs were
  paying funding and all 20 shorts were receiving it. Holdings plans, which go short, currently earn it.
- **WTI is priced by Pyth Lazer only** (no classic Pyth feed), and Veranta's test network has no WTI
  price at the moment, so WTI is proven on the mainnet fork with real signed prices.
- **Test network:** Veranta's test network has no public faucet (its SDK's dev faucet method is not
  served). `scripts/testnet-run.mjs` prints the addresses to fund and runs once they hold test funds.
