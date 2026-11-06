---
name: locke
description: Protect what a wallet or business holds or buys with a hedge on Base, through Locke. Use when the user wants to protect, hedge or insure tokenized stocks (NVDA, AAPL, TSLA and 54 more Coinbase tokenized stocks, or S&P 500 / Nasdaq 100 exposure), an ETH or BTC treasury, or crude oil and fuel costs (WTI or Brent) against a price move. Locke sizes the hedge from live Veranta prices and returns the Base transactions that create a vault the user owns; Locke's keeper then opens the hedge on Veranta and keeps its margin topped up.
tags: [base, hedging, tokenized-stocks, risk, defi, veranta, x402]
version: 1
visibility: public
metadata:
  clawdbot:
    emoji: "🛡️"
    homepage: "https://rebase.trylocke.online/agents"
---

# Locke: protection vaults on Base

Locke protects a price exposure with a hedge on **Veranta** (a perpetuals venue on Base), opened from a
**vault the user owns**. The user deposits USDC into their own vault; Locke's keeper opens the hedge,
watches it every few seconds and adds margin from the vault's buffer. Only the owner can withdraw or
close. Every live hedge gets a public "Protected by Locke" attestation on Base.

What can be protected:

| Plan | Hedge | Markets |
| --- | --- | --- |
| `stocks`: shares held (tokenized on Base or not) | short | 57 stocks (NVDA, AAPL, TSLA, MSFT, AMZN, META, GOOG, AMD, PLTR, AVGO…), plus `US500` and `US100` |
| `holdings`: a crypto treasury | short | `ETH`, `BTC` |
| `costs`: crude oil or fuel the business buys | long | `WTI`, `BRENT` |

Base URL: `https://rebase.trylocke.online`. Full request and response shapes: `references/api.md`.

## When to use this skill

- "Protect my NVDA", "hedge my tokenized stocks", "insure my ETH treasury against a drop",
  "lock in my diesel / jet fuel / crude costs", "what would it cost to protect $5,000 of Apple?"
- Not for: speculative trading, leverage for profit, or anything for a **US person**. Stock plans are
  closed to US persons; do not create one for a user who is, or may be, a US person.

## Flow

1. **Quote** (x402, $0.01): `GET /api/agent/quote?market=NVDA&valueUsd=5000&sharePct=50`
   Returns the hedge size, the USDC deposit, margin, fees, on-chain limits and the daily holding cost.
   Show the user the deposit and daily cost and get their go-ahead before step 2.
2. **Plan** (x402, $0.05): `POST /api/agent/plan` with `{ "owner": "<user wallet>", ...same inputs }`.
   For a stock plan add `"eligibility": "not-us-person"` only after the user confirms they are not a
   US person. Returns `calls`: two Base transactions (USDC `approve`, then `createVault`).
3. **Send** the two calls, in order, from the **owner's** wallet on Base (chain 8453). With a Bankr
   wallet: `POST https://api.bankr.bot/wallet/submit` once per call with
   `{ "transaction": { "to": call.to, "chainId": 8453, "value": "0", "data": call.data }, "description": call.description, "waitForConfirmation": true }`.
   Arbitrary contract calls must be allowed for the wallet in the Bankr console.
4. **Register** (free): `POST /api/agent/vaults` with `{ "txHash": "<createVault tx hash>", "inputs": { ...same inputs } }`.
   The keeper then opens the hedge, usually within a minute while the market is open.
5. **Status** (free): `GET /api/agent/vaults/<vault address>` for status, amount protected and the proof.

## Paying with x402

The quote and plan endpoints answer `402 Payment Required` with x402 v2 payment requirements:
scheme `exact`, network `eip155:8453`, asset USDC on Base. Sign the payment with the wallet (an
EIP-3009 `transferWithAuthorization` for the stated amount to the stated `payTo`) and retry the same
request with the signed payload in the `PAYMENT-SIGNATURE` header (`X-PAYMENT` also works). A payment
is taken once per successful answer. `GET /api/agent` lists the endpoints, prices and whether paid
calls are live right now (`live`).

## Inputs

- Stocks and holdings: `market` (e.g. `NVDA`, `US500`, `ETH`, `BTC`), `valueUsd` (value held),
  `sharePct` (10–100, how much of it to protect).
- Costs: `market` (`WTI` or `BRENT`), `product` (`crude`, `diesel`, `petrol`, `jet`, `marine`,
  `heating`, `lpg`, `asphalt`, `petrochemicals`), `monthlySpendUsd`, `months` (1–6),
  `crudeSharePct` (10–100: crude oil is 100; diesel about 60; petrol about 50).
- Optional for all: `leverage` (default 2), `bufferPct` (margin kept for top-ups; default 50, or 75
  for stocks because stock markets close overnight).

## What to tell the user

- The hedge offsets the price move on the protected share, minus Veranta's fees and holding cost; it
  is not a guarantee. Stock and oil hedges can't be closed while their market is closed.
- They own the vault: they can withdraw idle USDC or close the hedge themselves at
  `https://rebase.trylocke.online/plans/<vault>` (sign in with the owner wallet).
- They can get alerts on Telegram or by email from `https://rebase.trylocke.online/account`.

Terms: https://rebase.trylocke.online/legal/terms · Risks: https://rebase.trylocke.online/legal/risk
