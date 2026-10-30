// Locke on Base: addresses, contract interfaces and the plan markets. Safe to import anywhere.
// The vault and factory ABIs are the parts the app and keeper call; tests/base.test.ts checks them
// against the compiled contracts in contracts/.

import { parseAbi } from "viem";

export const BASE_CHAIN_ID = 8453;
export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
/** Veranta (formerly Avantis) on Base, from tx-builder.veranta.xyz/v2/meta. */
export const VERANTA_ROUTER = "0x44914408af82bC9983bbb330e3578E1105e11d4e" as const;
export const VERANTA_STORAGE = "0x8a311D7048c35985aa31C131B9A13e03a5f7422d" as const;

/** Fixed-point units on chain. */
export const P10 = 10_000_000_000n;
export const USDC_UNIT = 1_000_000n;
export const usdcUnits = (usd: number) => BigInt(Math.round(usd * 1e6));
export const fromUsdcUnits = (v: bigint) => Number(v) / 1e6;

/** Signed Pyth Lazer updates cost this much ETH to verify on Base (PythLazer.verification_fee). */
export const LAZER_FEE_WEI = 1n;
/** Price sourcing for margin updates: Pyth Lazer, the only feed WTI and Brent have. */
export const PRICE_SOURCING_LAZER = 1;

export type BasePlanType = "holdings" | "costs";

/** Markets Locke offers on Base, and the side each plan type hedges. */
export const BASE_MARKETS = [
  { pairIndex: 0, symbol: "ETH/USD", asset: "ETH", type: "holdings", buy: false, label: "ETH treasury" },
  { pairIndex: 1, symbol: "BTC/USD", asset: "BTC", type: "holdings", buy: false, label: "BTC or cbBTC treasury" },
  { pairIndex: 96, symbol: "WTI/USD", asset: "WTI", type: "costs", buy: true, label: "Fuel priced off WTI" },
  { pairIndex: 97, symbol: "BRENT/USD", asset: "BRENT", type: "costs", buy: true, label: "Fuel priced off Brent" },
] as const satisfies readonly { pairIndex: number; symbol: string; asset: string; type: BasePlanType; buy: boolean; label: string }[];

export type BaseMarket = (typeof BASE_MARKETS)[number];

export function baseMarket(pairIndex: number): BaseMarket | undefined {
  return BASE_MARKETS.find((m) => m.pairIndex === pairIndex);
}

export const factoryAbi = parseAbi([
  "struct Plan { bool enabled; bool buy; uint64 maxLeverage; uint128 maxNotional; }",
  "function createVault(uint256 pairIndex, Plan plan, uint256 deposit) returns (address vault)",
  "function paused() view returns (bool)",
  "function feeBps() view returns (uint16)",
  "function keeper() view returns (address)",
  "function maxVaultDeposits() view returns (uint256)",
  "function maxTotalDeposits() view returns (uint256)",
  "function totalDeposits() view returns (uint256)",
  "function isVault(address) view returns (bool)",
  "function feeCollector() view returns (address)",
  "function keeperRevoked(address) view returns (bool)",
  "event VaultCreated(address indexed owner, address indexed vault, uint256 indexed pairIndex, bool buy, uint128 maxNotional, uint16 feeBps)",
]);

export const vaultAbi = parseAbi([
  "function tradingStorage() view returns (address)",
  "function owner() view returns (address)",
  "function keeper() view returns (address)",
  "function paused() view returns (bool)",
  "function feeBps() view returns (uint16)",
  "function netDeposits() view returns (uint256)",
  "function plans(uint256 pairIndex) view returns (bool enabled, bool buy, uint64 maxLeverage, uint128 maxNotional)",
  "function lastOpenAt(uint256 pairIndex) view returns (uint256)",
  "function feeOwed(uint256 pairIndex) view returns (uint256)",
  "function lastFeeAt(uint256 pairIndex) view returns (uint256)",
  "function settleFee(uint256 pairIndex)",
  "function deposit(uint256 amount)",
  "function withdraw(address to, uint256 amount)",
  "function setKeeper(address keeper)",
  "function setPlan(uint256 pairIndex, bool enabled, bool buy, uint64 maxLeverage, uint128 maxNotional)",
  "function ownerClose(uint256 pairIndex, uint256 index, uint256 collateral, uint256 wantedPrice) payable returns (uint256)",
  "function hedgeOpen(uint256 pairIndex, uint256 collateral, uint256 leverage, uint256 wantedPrice, uint256 slippageP) payable returns (uint256)",
  "function hedgeClose(uint256 pairIndex, uint256 index, uint256 collateral, uint256 wantedPrice) payable returns (uint256)",
  "function topUpMargin(uint256 pairIndex, uint256 index, uint256 amount, bytes[] priceUpdateData, uint8 priceSourcing) payable returns (uint256)",
  "event Deposited(address indexed from, uint256 amount)",
  "event Withdrawn(address indexed to, uint256 amount)",
  "event HedgeOpenRequested(uint256 indexed pairIndex, uint256 orderId, bool buy, uint256 collateral, uint256 leverage)",
  "event HedgeCloseRequested(uint256 indexed pairIndex, uint256 indexed index, uint256 orderId, uint256 collateral, address by)",
  "event MarginUpdated(uint256 indexed pairIndex, uint256 indexed index, uint8 updateType, uint256 amount, address by)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

/** What the keeper reads from Avantis's TradingStorage to know whether a vault's hedge exists. */
export const tradingStorageAbi = parseAbi([
  "function openTradesCount(address trader, uint256 pairIndex) view returns (uint256)",
  "function pendingMarketOpenCount(address trader, uint256 pairIndex) view returns (uint256)",
]);

