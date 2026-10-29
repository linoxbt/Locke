# Locke

**Protect what your business holds. Manage what it needs to buy.**

Locke helps businesses manage price risk using [Strike Finance](https://strikefinance.org) perpetuals. A business tells Locke what it wants to protect — ADA it holds, or the fuel it buys every month — and Locke opens, sizes and monitors a hedge on Strike, presented as a **protection plan**.

It's built for a business that holds part of its treasury in ADA and spends money on diesel: for example, a Cardano stake pool operator running generators through grid outages. Falling ADA shrinks its budget and rising fuel prices raise its costs. Locke manages both exposures from one portfolio, with each plan's margin kept separate.

| Plan | Protects against | Strike market | Side | Hedge quality |
|---|---|---|---|---|
| **Holdings** | A fall in the value of ADA held | `ADA-USD` | Sell (short) | Direct: the hedge tracks the same asset |
| **Operating costs** | A rise in fuel costs | `WTI-USD` | Buy (long) | Partial: crude explains only part of local pump prices |

Every plan follows the same path: **describe exposure → preview scenarios and costs → fund and open → monitor → adjust or close.**

Locke is not a trading terminal. Every screen is about an exposure the business already has.

**Live:** https://trylocke.online · builder code **LockeIn** (up to 20 bps registered; orders carry `STRIKE_BUILDER_FEE_BPS`).

## What it does

- **One wizard, two plan types.** The holdings form reads the wallet's ADA balance through CIP-30. The costs form takes litres per month, pump price, FX rate, months covered and an explicit *crude share* assumption.
- **Preview before funding.** Locke shows the hedge in plain words, the margin to deposit (USD and ADA), the opening cost (Strike taker fee plus builder fee), funding per day at the live rate ("cost of protection"), and the outcome at −50/−25/−10/+10/+25/+50%. It also shows the price where Locke would ask for a top-up and the estimated liquidation price.
- **Real hedges on Strike mainnet.** One signed ADA deposit, then isolated margin and leverage are set on the market and a market order goes out carrying Locke's builder fee. The buffer margin is added after the fill.
- **Separate margin per plan.** Each plan is an isolated position on its own market, so trouble in one never draws on the other's collateral.
- **Monitoring, two ways.** A scheduled Netlify function (`netlify/functions/monitor.mts`) sweeps every minute: it advances waiting plans and checks every live plan's margin health over Strike's REST API. When the long-running worker below is deployed it takes over (the sweep stands down while the worker holds its lock).
- **Risk worker.** A long-running process streams mark prices and each user's Strike stream. It recomputes every plan's margin ratio once a second and flags a plan *before* Strike's own levels (details below). Alerts are written to the plan and shown in Locke; nothing is sent outside the app yet.
- **One-tap, wallet-signed top-up.** Locke suggests an amount, the wallet signs a Cardano deposit, and once Strike credits it Locke adds it to that plan's isolated margin only.
- **Resize and close.** Holdings plans resize to a new share or ADA amount. Costs plans close one month's worth (S ÷ T) to match fuel used. Close is a reduce-only market order.
- **Replay.** The plan runs against up to 180 days of Strike's daily mark prices, with and without Locke, animated over about 10 seconds with a scrubber.
- **Delegation evidence.** Koios shows the ADA is still staked to its pool and still delegated to its DRep.
- **Withdraw.** Free balance on Strike goes back to the connected wallet, signed by the wallet. Money credited for a plan that hasn't used it yet (an opening deposit or a pending top-up) is set aside and can't be withdrawn.

### Risk levels

| Level | Trigger | What Locke does |
|---|---|---|
| Watch | margin ratio ≥ 50% **or** mark within 20% of liquidation | Card turns amber |
| Action needed | margin ratio ≥ 60% **or** mark within 10% of liquidation | Alert with a one-tap top-up |
| Margin call | ratio ≥ 70% (Strike) | Red banner, repeat alert |
| Reduce only | ratio ≥ 90% (Strike) | Strike blocks risk-increasing orders |
| Liquidation | ratio ≥ 100% (Strike) | Strike liquidates; Locke alerts at once |

A plan leaves Watch only when the ratio falls below 45% and the distance rises above 22% (hysteresis).

The distance check exists because margin ratio only rises steeply in the last few percent before liquidation. On a 1x plan, a 60% ratio alert would fire about 0.3% before liquidation, too late for a Cardano deposit to confirm. The suggested top-up is enough to bring the ratio back to 35% *and* push liquidation 25% away from the mark.

### Fuel plans (operating costs)

- **Fuels:** diesel, petrol, kerosene / jet fuel and cooking gas (LPG). LPG counts as two-thirds of a litre of crude per litre, by energy content.
- **Reference prices:** Nigeria, Kenya, Ghana and the Philippines, from GlobalPetrolPrices.com (official and industry sources), snapshot of 19 Oct 2026 with 1-month, 3-month and 1-year history (`src/lib/domain/fuel.ts`). Kenya LPG, Ghana LPG and Ghana kerosene have no current reference; the form asks for the user's price.
- **Calibrated crude share:** crude's cost in a litre (live WTI ÷ 158.987 L × the fuel's crude content × the live exchange rate) over the pump price, clamped to 5–95%. Users can override it and return to the calibrated value.
- **Budget mode:** "keep my monthly bill under X even if crude rises r%". With crude share c, cover s keeps the bill at B × (1 + c·r·(1 − s)), so Locke hedges s = 1 − (X/B − 1)/(c·r) of the crude-linked cost. The server recomputes s from the budget; a budget below today's bill, or one that needs no hedge, is refused with the reason.
- **Exchange-rate warning:** live and 90-day-old dollar rates (open fawazahmed0 currency API via jsDelivr, Cloudflare mirror) show how the currency moved, and what a further 10% fall adds to the bill. A WTI hedge can't cover that, and the form and preview say so.

## Pages

Every feature is its own server-rendered route. Pages load their data on the server, guard by
plan status (a draft can't open the top-up page, for example) and redirect with real HTTP status
codes. A middleware gate sends signed-out visitors to `/connect?next=<page>` and brings them back.

| Route | What it is |
|---|---|
| `/` | Home, with live ADA-USD and WTI-USD marks from Strike |
| `/how-it-works` | The four steps, both plan types, the alert ladder |
| `/connect` | Connect a CIP-30 wallet and sign in through Strike's builder connect |
| `/portfolio` | Total value protected and one card per plan |
| `/protect` | Choose what to protect |
| `/protect/holdings`, `/protect/costs` | Describe the exposure; submitting creates a draft |
| `/plans/[id]/preview` | Hedge, costs, scenarios, safety prices, disclosures |
| `/plans/[id]/fund` | Sign the ADA deposit and follow it until the hedge is open |
| `/plans/[id]` | Overview: headline number, margin health, stats, latest events |
| `/plans/[id]/top-up` | Wallet-signed top-up, added to this plan's margin only |
| `/plans/[id]/resize` | Holdings: new share or amount. Costs: close one month (S ÷ T) |
| `/plans/[id]/close` | Reduce-only close at market |
| `/plans/[id]/replay` | The plan against Strike's real price history |
| `/plans/[id]/activity` | Full event log and margin-ratio history |
| `/plans/[id]/strike` | Raw position fields and deposits with transaction links |
| `/withdraw` | Free balance back to the connected wallet, wallet-signed |
| `/account` | Wallet, stake pool and DRep, Strike balance, sign out |

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI[Next.js app<br/>wizard · portfolio · plan detail]
    W[CIP-30 wallet<br/>Eternl / Lace / …]
  end
  subgraph Netlify
    API[Route handlers<br/>sizing · lifecycle · signing]
  end
  subgraph Railway
    RW[Risk worker<br/>marks · user streams · alerts · snapshots]
  end
  DB[(Postgres / Supabase<br/>users · strike_links · plans<br/>deposits · plan_events · snapshots)]
  S[Strike API<br/>REST + WebSockets]
  K[Koios]

  UI <--> API
  UI -- signData / signTx --> W
  API -- Ed25519-signed REST --> S
  RW -- session.logon + userstream<br/>markPrice@1s --> S
  RW -- REST positions / orders --> S
  API <--> DB
  RW <--> DB
  API --> K
```

- **The browser** only ever signs money movements: the builder-connect challenge, each deposit transaction, and each withdrawal.
- **The server** generates one Ed25519 API wallet per user during connect. It encrypts the key with AES-256-GCM and signs routine Strike calls (orders, leverage, margin mode, isolated margin, positions). The private key never reaches the browser.
- **The risk worker** runs the same plan lifecycle code as the API (`src/lib/server/planService.ts`), so a plan finishes opening even if the user closes the tab.

### Code map

| Path | What |
|---|---|
| `src/lib/domain/` | Pure math: sizing, scenarios, crude-share pump model, replay, margin ratio, liquidation and alert prices, risk levels |
| `src/lib/strike/` | Strike REST client and Ed25519 request / `session.logon` signing |
| `src/lib/cardano/` | CIP-30 wallet, bech32, and a byte-preserving CBOR witness merge for Strike's deposit transactions |
| `src/lib/server/planService.ts` | Plan lifecycle state machine (compare-and-set transitions, so two callers never place the same order) |
| `src/app/api/` | Route handlers |
| `src/app/` | Pages (see the table above) and API route handlers |
| `worker/index.ts` | Risk worker |
| `db/schema.sql` | Schema (idempotent) |

## How Locke uses Strike

Every authenticated call goes through the user's builder-connected API wallet and is signed as `METHOD:PATH:TIMESTAMP:NONCE:SHA256(body)`. Every order carries `X-Builder-Fee-Bps`, a server constant at or below the fee share the user approved.

| Step | Endpoint |
|---|---|
| Connect (login) | `POST /auth/builder/request-signature` (`chain: "cardano"`), then `POST /auth/builder/verify-signature` with the CIP-30 `signData` result |
| Market rules | `GET /price/v2/exchangeInfo` (step size, minimum notional), `GET /v2/markets` (margin tiers), `GET /v2/fee-tiers` |
| Live price and funding | `GET /price/v2/markPrice` (`p` mark, `r` hourly funding rate); WebSocket `/ws/price`, `markPrice@1s` |
| Liquidity | `GET /price/v2/depth`: the preview walks the book for the hedge's size (average fill, slippage over the mark); open and resize-up re-read it fresh and refuse a market order the book can't fill within 1% of the mark |
| History | `GET /price/v2/klines?interval=1d&priceType=mark` |
| Deposit | `POST /v2/deposit/quote` (ADA, lovelace) → `POST /v2/deposit/build-tx` (CIP-30 UTxOs) → wallet signs and submits → `POST /v2/deposit` with the tx hash |
| Deposit credited | `GET /v2/history/transaction?type=1` matched by tx hash |
| Balance | `GET /v2/account` |
| Isolated margin | `POST /v2/marginMode` (`isolated`), checked with `GET /v2/symbols` |
| Leverage | `POST /v2/leverage` |
| Open, resize, close | `POST /v2/order` with `X-Builder-Fee-Bps`, `client_order_id = locke-{planId}-{action}-{n}`, `reduce_only` for reductions |
| Add margin | `POST /v2/isoMargin` (`modify_type: "add"`) for the buffer after the fill and for each top-up |
| Positions | `GET /v2/positions?symbol=…` (`iso_balance`, `maintenance_margin`, `liquidation_price`, `accumulated_funding_fees`) |
| User stream | WebSocket `/ws/user-api`: `session.logon`, `subscribe userstream`, `ACCOUNT_UPDATE` and `ORDER_TRADE_UPDATE` |
| Withdraw | `POST /v2/withdraw/quote` → wallet signs `message_to_sign` (and `tx_cbor`) → `POST /v2/withdraw` |

Verified against mainnet while building:

- The user stream answers on `wss://api.strikefinance.org/ws/user-api`; the `api-v2` host in one doc page does not resolve.
- `ADA-USD` mark history starts 2026-03-19 and `WTI-USD` starts 2026-04-23, so both support 180-day replays.
- The reduce-only field is `reduce_only`, and the hourly funding rate is `r` on `markPrice`.

## Run it

Requirements: Node 22, Postgres (local or Supabase), a builder code from Strike's Builder Dashboard, and a CIP-30 wallet on Cardano mainnet.

```bash
cp .env.example .env.local     # fill in the values below (the app, worker and scripts all read it)
npm install
npm run db:migrate             # applies db/schema.sql (safe to re-run)
npm run dev                    # app on http://localhost:3000
npm run worker                 # risk worker (separate terminal)
npm run strike:check           # readiness: config, Strike REST/WebSocket, history, liquidity, DB
npm run strike:check -- --signed   # + signed GET /v2/account and user-stream logon (after a wallet connects)
npm test                       # unit tests
TEST_DATABASE_URL=postgres://…/locke_test npm test   # + lifecycle integration test (throwaway DB)
```

### Environment variables

| Name | Where | Purpose |
|---|---|---|
| `STRIKE_API_URL` | app, worker | `https://api.strikefinance.org` |
| `STRIKE_WS_USER_URL` | worker | Defaults to `STRIKE_API_URL`'s host + `/ws/user-api` |
| `STRIKE_WS_PRICE_URL` | worker | Defaults to `STRIKE_API_URL`'s host + `/ws/price` |
| `STRIKE_BUILDER_CODE` | app | Locke's builder code |
| `STRIKE_BUILDER_FEE_BPS` | app, worker | **Required.** Fee per order in whole bps, 0 to `STRIKE_BUILDER_MAX_BPS`; the app and worker refuse to start without it |
| `STRIKE_BUILDER_MAX_BPS` | app, worker | The builder code's registered maximum (default `20`, LockeIn's) |
| `NEXT_PUBLIC_CARDANO_NETWORK_ID` | app | `1` mainnet (`0` with the testnet API) |
| `KOIOS_URL` | app | `https://api.koios.rest/api/v1` |
| `DATABASE_URL` | app, worker | Postgres URL (the Supabase pooler works; use the session pooler, port 5432, for the worker) |
| `DATABASE_POOL_MAX` | app, worker | Connections per process (default `3`; keep 1–2 on Netlify with the transaction pooler) |
| `DATABASE_PREPARE` | app, worker | `false` to force prepared statements off (they're off automatically on port 6543) |
| `NEXT_PUBLIC_SITE_URL` | app | Public URL, also accepted by the same-origin check |
| `PORT` | worker | Port for `/healthz` (Railway sets it) |
| `LOCKE_KEY_ENC` | app, worker | 32 bytes hex; encrypts API wallet keys (`openssl rand -hex 32`) |
| `SESSION_SECRET` | app | At least 32 characters; signs session cookies |
| `LOCKE_DEMO_ALERTS` | app, worker | `true` lowers alert levels for a demo (labelled on screen) |
| `BASE_FACTORY_ADDRESS` | app, base keeper | Locke on Base: the deployed `LockeVaultFactory`. Unset, `/base` shows "not live yet" |
| `BASE_RPC_URL` | app, base keeper | Base RPC (default `https://mainnet.base.org`; Veranta's test network: `https://devnet-rpc.veranta.xyz`) |
| `BASE_BUILDER_CODE` | app, base keeper | Locke's Base Builder Code (`bc_…`), appended to every Base transaction (ERC-8021) |
| `BASE_KEEPER_PRIVATE_KEY` | base keeper | The keeper key (0x + 64 hex). Trades vaults within their on-chain limits; can never withdraw. Needs a little ETH on Base |
| `VERANTA_API_URL`, `VERANTA_FEED_URL` | app, base keeper | Veranta's API and signed-price feed (defaults to production) |

### Deploy

- **App:** Netlify (`netlify.toml`, Next.js runtime). Set the variables above in the Netlify UI with the Functions scope and mark the secrets as secret.
- **Worker:** create a Railway service from the same repo with the same `DATABASE_URL` (the **session** pooler, port 5432, or a direct connection: the worker holds an advisory lock so only one instance is active), `LOCKE_KEY_ENC` (must equal the app's) and `STRIKE_BUILDER_FEE_BPS`. `railway.json` runs the schema migration before each deploy, starts `tsx worker/index.ts`, and gates deploys on `/healthz`. The worker exits after two minutes unhealthy so Railway restarts it.
- **Base keeper (Locke on Base):** a second Railway service from the same repo, start command `npx tsx worker/base-keeper.ts` (override it in the service settings; `railway.json` names the Strike worker), with `DATABASE_URL`, `BASE_FACTORY_ADDRESS`, `BASE_KEEPER_PRIVATE_KEY`, `BASE_BUILDER_CODE` and optionally `BASE_RPC_URL`. It answers `/healthz` (503 when it can't read Base or the database, or is low on ETH) and holds its own advisory lock.
- **Database:** create a Supabase project, put its connection string in `DATABASE_URL`, and run `npm run db:migrate` (safe to re-run after every schema change).

## Locke on Base

A second version of Locke under `/base`, for businesses on Base. Each business signs in with **Sign in with Base** (Base Account, or any EVM wallet) and creates its own `LockeVault` contract (see `contracts/`): the vault holds its USDC and is the trader on [Veranta](https://www.veranta.xyz) (formerly Avantis), so every payout comes back to it. Holdings plans short ETH or BTC; costs plans go long WTI or Brent.

- **Sign-in:** Sign-In with Ethereum. Base Account answers `wallet_connect` with the signed message; other wallets sign it with `personal_sign`. The server checks the domain, URI, chain (8453), age and a single-use nonce, then the signature: recovered locally for ordinary wallets, verified on Base for smart wallets (ERC-1271, or ERC-6492 before deployment). Its own session cookie and `base_users` table, separate from the Strike sign-in.
- **Vaults:** the business's wallet approves USDC and calls `createVault` in one batch (`wallet_sendCalls`; one transaction per call in wallets without batching). The server records a vault only from its `VaultCreated` event in that transaction, checks the owner is the signed-in account and that the limits on Base match the plan. Deposit, withdraw, closing the hedge and removing the keeper all go straight from the owner's wallet to the vault.
- **Keeper:** `worker/base-keeper.ts` opens the hedge once the deposit is in, adds margin from the vault's buffer when margin use reaches Locke's action level (60%), and marks the vault closed when the owner closes the hedge. Its decisions are in `src/lib/base/keeper.ts`.
- **Builder Codes:** every transaction from the app and the keeper carries Locke's Base Builder Code (ERC-8021 data suffix) when `BASE_BUILDER_CODE` is set.

## Security

- The Strike API wallet key is generated on the server, encrypted with AES-256-GCM under `LOCKE_KEY_ENC`, and never sent to the browser or logged. A leaked key could place trades, but it could not move money out: withdrawals need the user's own wallet signature and only go to the connected wallet.
- Login is wallet-signed. Locke verifies the CIP-30 signature itself before asking Strike (the signed address is the one logging in, the key hashes to its payment credential, the payload is the exact challenge, and the Ed25519 signature holds), then Strike verifies it too. Locke issues an HMAC-signed, HTTP-only `__Host-` session cookie that lasts 24 hours. Signing out bumps a per-user session version, which ends every session on every device. Sign-in starts are rate-limited per network (/24, /64) and globally, under a lock so parallel requests can't slip past; the stake address is derived on the server and shown as derived.
- Deposits are bound to the transaction Locke built (its id is stored at build time), signed-in routes that call Strike are rate-limited per user, and the database's public API roles have no table access.
- API wallet keys are encrypted with AES-256-GCM bound (as associated data) to the key's own public key, so an encrypted key copied onto another user's row won't decrypt.
- State-changing routes check `Origin` against the host, on top of `SameSite=Lax` cookies. Bodies are capped at 256 KB and every field is length-checked. Pages send CSP `frame-ancestors`/`object-src`/`base-uri`/`form-action` rules, HSTS and a Permissions-Policy. (A strict `script-src` is left out because CIP-30 wallet extensions inject scripts into the page.)
- Funding and opening require a recorded acknowledgement of the risks. Deposits only build from the signed-in address. Withdrawals are recorded, must belong to the user, and are confirmed with the fully signed transaction after a fee review.
- The server recomputes every order (size, side, symbol, reduce-only) from the stored plan and never trusts sizes from the browser.
- Plan status changes are compare-and-set updates, and every order carries a deterministic client order id (`locke-{plan}-{action}-{n}`) with at most one pending per plan. A lost response is resolved by looking the order up on Strike, never by sending it again, so retries and races can't double-open, double-close or double-resize a plan. Margin adds are verified by re-reading the position.
- Row-level security is enabled on every table. The app and worker use a server role.

## Known limits

- **Customer validation.** The SPO and Cardano-team customer is a hypothesis that still needs validating with real operators.
- **Basis risk on fuel.** WTI explains only part of local pump prices. The plan is labelled "Partial hedge — crude share only", and the crude share is the user's own assumption.
- **Replay funding.** Strike publishes no funding-rate history, so the replay lines show price effects only. Funding at today's rate is shown alongside as a labelled projection.
- **Cardano only.** Deposits are ADA from a CIP-30 wallet; Solana and Ethereum deposits are out of scope.
- **One plan per market per user.** This comes from isolated margin on the main account. Strike sub-accounts can't be created through the API.
- **Top-ups need a signature.** Locke never moves funds on its own; it alerts early (and repeats every 15 minutes at margin call or worse) and makes the top-up one tap.
- **Polling, not push, in the browser.** Plan pages poll every 5–10 s; the worker holds the WebSocket streams. Supabase Realtime isn't used.
- **Minute-level monitoring without the worker.** Railway was unavailable on submission day, so the deployed monitoring is the one-minute scheduled sweep; the real-time worker (per-second marks, liquidation events from the user stream) runs when deployed.
- **No alerts outside the app.** The worker flags plans and writes alerts (repeating at margin call or worse), and tells the user when it can't watch a plan, but there's no email, push or Telegram channel yet: a user sees alerts when they open Locke.
- **Sub-accounts and funding history.** Strike sub-accounts (spec §6.6) aren't used; each plan is an isolated position on the main account. Funding to date comes from the position's `accumulated_funding_fees`, not `/v2/history/funding`.
- **Dependencies.** `npm audit` still reports postcss inside Next 15 (build-time only); the fix is a Next 16 upgrade.
- **API key lifetime.** Signing in again replaces the API key Locke stores and deletes the old one from Locke; Locke doesn't revoke it on Strike, so it lapses at its own expiry.

## Disclaimer

Locke is a tool, not financial advice. Hedges can lose money on their own: a holdings hedge gives up upside, and a fuel hedge loses if fuel prices fall. Positions can be liquidated if margin runs out. Strike has eligibility rules, so check Strike's restricted persons policy before using it.
