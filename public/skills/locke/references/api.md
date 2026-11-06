# Locke agent API reference

Base URL `https://rebase.trylocke.online`. JSON in and out. Errors are `{ "error": "<plain message>" }`
with a 4xx/5xx status; show the message to the user.

## GET /api/agent

Free. Discovery: `{ name, description, live, vaultsLive, payment: { protocol: "x402", version: 2, scheme: "exact", network: "eip155:8453", asset: "USDC", payTo }, markets: [{ market, symbol, plan, hedge }], endpoints: [{ method, path, price, what, url }], eligibility }`.
`live: false` means paid calls are switched off right now.

## GET /api/agent/quote  ($0.01, x402)

Query string, examples:

```
/api/agent/quote?market=NVDA&valueUsd=5000&sharePct=50
/api/agent/quote?market=ETH&valueUsd=20000&sharePct=40&leverage=2
/api/agent/quote?market=WTI&product=diesel&monthlySpendUsd=10000&months=3&crudeSharePct=60
```

Answer (example values):

```json
{
  "inputs": { "type": "stocks", "pairIndex": 81, "valueUsd": 5000, "sharePct": 50, "leverage": 2, "bufferPct": 75 },
  "market": { "symbol": "NVDA/USD", "price": 184.53, "open": true },
  "sizing": {
    "pairIndex": 81, "buy": false, "notionalUsd": 2500, "leverage": 2,
    "collateralUsd": 1250, "bufferUsd": 937.5, "feesUsd": 4.5, "depositUsd": 2192,
    "limits": { "maxLeverage": 2, "maxNotionalUsd": 2750, "maxCollateralUsd": 2187.5 }
  },
  "carryPerDayUsd": 0.31
}
```

`notionalUsd` is the size of the hedge; `depositUsd` is the USDC the vault needs (margin, buffer and
Veranta's fees). `carryPerDayUsd` is the holding cost per day at today's rates (negative: the hedge is
being paid). `market.open: false` means the market is closed now: the hedge opens when it reopens.

## POST /api/agent/plan  ($0.05, x402)

```json
{ "owner": "0xOwnerWallet", "market": "NVDA", "valueUsd": 5000, "sharePct": 50, "eligibility": "not-us-person" }
```

`eligibility: "not-us-person"` is required for stock plans (the user confirms they are not a US person).
Answer: the quote above plus

```json
{
  "lockeFeeUsd": 5,
  "depositUsd": 2197,
  "owner": "0xOwnerWallet",
  "chainId": 8453,
  "calls": [
    { "to": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "data": "0x095ea7b3…", "value": "0x0", "description": "Approve 2197 USDC for Locke's vault factory" },
    { "to": "0x0c594a6d7f850fc07e2c797bfad2f087b2610be8", "data": "0x…", "value": "0x0", "description": "Create the vault, owned by the sender, with these limits and deposit" }
  ],
  "next": "Send the calls from the owner's wallet…"
}
```

Send `calls` in order from `owner` on Base. `depositUsd` includes Locke's fee (0.20% of the hedge).
The owner wallet needs that much USDC and a little ETH for gas.

## POST /api/agent/vaults  (free)

```json
{ "txHash": "0xCreateVaultTxHash", "inputs": { "market": "NVDA", "valueUsd": 5000, "sharePct": 50 } }
```

Answer: `{ "address": "0xVault", "status": "https://rebase.trylocke.online/api/agent/vaults/0xVault" }`.
The transaction proves the owner; the inputs must match the limits the vault was created with.

## GET /api/agent/vaults/{address}  (free)

```json
{
  "address": "0xvault", "market": "NVDA/USD", "plan": "stocks", "status": "active",
  "protectedUsd": 2500, "openedAt": "2026-11-06T14:02:11Z", "closedAt": null,
  "proof": "https://rebase.trylocke.online/proof/0x…"
}
```

`status`: `funding` (waiting for the deposit), `opening` (hedge sent to Veranta), `active`
(protected), `closed`.

## Links for the user

- Their plan: `https://rebase.trylocke.online/plans/{vault}`
- Alerts (Telegram, email): `https://rebase.trylocke.online/account`
- Contracts: factory `0x0c594a6d7f850fc07e2c797bfad2f087b2610be8` on Base, source verified on Sourcify.
