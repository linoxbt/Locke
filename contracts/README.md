# Locke on Base: vault contracts

Each business gets a `LockeVault` on Base. The vault holds the business's USDC and is the trader on
[Veranta](https://www.veranta.xyz) (Avantis until September 2026), so every payout lands back in the
vault. Locke's keeper can steer the hedge within the owner's plan limits; it can never move funds.

| Role | Can | Can never |
| --- | --- | --- |
| Owner (the business's wallet) | Deposit, withdraw idle USDC, close any hedge, add or remove margin, set plan limits, replace or remove the keeper, hand the vault over (two steps), rescue other tokens | n/a |
| Keeper (Locke's server) | `hedgeOpen` within the plan (market, side, max leverage, max notional, one position per market, one open per market per hour), `hedgeClose`, `topUpMargin` up to the plan's notional cap | Withdraw, change limits, remove margin, move USDC anywhere but Veranta (and the vault's fee, if it has one) |
| Guardian (Locke multisig, set on the factory) | Pause new deposits and new hedges for one vault or all of them | Block withdrawals, closes or top-ups |
| Admin (Locke multisig, factory only) | Set the guardian, the keeper and fee for new vaults, the fee collector and the launch caps; two-step handover | Touch any vault's money, limits or keeper |

`LockeVaultFactory.createVault(pairIndex, plan, deposit)` deploys a clone owned by the caller, sets
its first plan and funds it in one transaction. Vaults are not upgradeable.

**Locke's fee** is optional and fixed per vault when it is created: a share of the notional of each
hedge the keeper opens, at most 0.20% (`MAX_FEE_BPS = 20`), paid to the factory's fee collector.
It defaults to zero. Veranta's own builder-fee route needs an EIP-7702 account, which a contract
trader cannot use, so the vault charges it itself.

**Launch caps** count deposits less withdrawals, per vault and across all vaults. A withdrawal never
reverts because of them, including withdrawals of profits above what was deposited.

## Run

```bash
cd contracts
npm install
npx hardhat test                                       # offline unit + property-based tests (mock Veranta)
FUZZ_RUNS=1000 npx hardhat test test/fuzz.invariants.test.ts   # a longer property-based run
FORK=1 npx hardhat test test/fork.veranta.test.ts      # against the real Veranta contracts on a Base fork
node scripts/measure-fills.mjs                         # how fast Veranta fills directly-sent orders
node scripts/measure-funding.mjs                       # which side pays ETH/BTC funding right now
node scripts/testnet-run.mjs <keys.json> [out.json]    # live run on Veranta's test network (needs test funds)
```

### Deploy

```bash
npx hardhat compile
RPC_URL=https://mainnet.base.org DEPLOYER_PRIVATE_KEY=0x… \
ADMIN=0x<Locke multisig> GUARDIAN=0x<Locke multisig> KEEPER=0x<keeper address> \
MAX_VAULT_USD=1000 MAX_TOTAL_USD=25000 node scripts/deploy.mjs
```

It prints the factory address for the app's `BASE_FACTORY_ADDRESS`. To rehearse, run it against a
local Base fork (`FORK=1 npx hardhat node`, then `RPC_URL=http://127.0.0.1:8545`).

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

## Weeks 2–3 results (29 Oct 2026)

- **Contracts v1:** launch caps, an optional fee capped at 0.20%, two-step ownership and admin, a
  guardian that can pause one vault or all of them, a one-hour cooldown on keeper opens (so a stolen
  keeper key cannot churn fees), and a top-up cap. The owner still keeps every exit.
- **21 unit tests** cover every role and guard.
- **Property-based tests** (fast-check; Foundry's installer is blocked in this environment) run random
  sequences of actions by every role, with random amounts, markets, limits and time jumps. After each
  step they check that money only moves between the owner, the vault, Veranta and the fee collector;
  that fees stay under 0.20% of notional opened; that only the right role succeeds at each action;
  that every keeper open respected the plan, the cooldown and the pause; that the cap accounting adds
  up; and that the owner can close everything and withdraw every dollar, paused or not, keeper or
  not. 1,000 sequences (10,620 steps, 572 hedge opens, 443 top-ups) passed.
- **The Base fork test** still passes against the live Veranta contracts with v1.

### Slither

`slither . --filter-paths "node_modules|src/mocks"` (0.10.4, on a clean build). Fixed: a fee computed
by dividing before multiplying (now one division), a missing zero-address check on `sweepEth`, and an
event emitted after an external call in `createVault`. Six findings remain, all intended:

| Finding | Why it stays |
| --- | --- |
| No zero check on the keeper (vault `initialize`, `setKeeper`; factory constructor, `setKeeper`) | Zero means "no keeper": the owner removes Locke this way, and a factory with no keeper makes vaults Locke cannot trade. |
| `block.timestamp` in `hedgeOpen` | The hourly cooldown; a few seconds of validator drift do not matter. |
| Low-level call in `sweepEth` | Sending ETH needs it; owner-only, checked, reentrancy-guarded. |
