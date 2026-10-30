// The agent API's work: size a plan from live Avantis terms, and build the wallet calls that create
// the owner's own vault. The agent's (or business's) wallet sends them; Locke never holds funds.

import { concatHex, encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { builderSuffix } from "../base/builderCode";
import { BASE_MARKETS, erc20Abi, factoryAbi, USDC, usdcUnits } from "../base/contracts";
import { BasePlanError, parseBaseInputs, sizeBasePlan, type BasePlanInputs, type BaseSizing } from "../domain/basePlans";
import { verantaCarryPerDay } from "../domain/veranta";
import { getMarket, getSignedPrice } from "../veranta/client";
import { marketTerms, requireFactory } from "./baseVaults";
import { config } from "./config";
import { HttpError } from "./errors";

/** Plan inputs from a query string or JSON body; `market` may be a symbol (ETH, BTC, WTI, BRENT) instead of `pairIndex`. */
export function agentInputs(raw: Record<string, unknown>): BasePlanInputs {
  const r = { ...raw };
  if (r.market != null && r.pairIndex == null) {
    const m = BASE_MARKETS.find((x) => x.asset === String(r.market).toUpperCase() || x.symbol === String(r.market).toUpperCase());
    if (!m) throw new HttpError(400, `Unknown market. Use one of ${BASE_MARKETS.map((x) => x.asset).join(", ")}.`);
    r.pairIndex = m.pairIndex;
    r.type ??= m.type;
  }
  r.leverage ??= 2;
  r.bufferPct ??= 50;
  try {
    return parseBaseInputs(r);
  } catch (e) {
    if (e instanceof BasePlanError) throw new HttpError(400, e.message);
    throw e;
  }
}

export interface AgentQuote {
  inputs: BasePlanInputs;
  market: { symbol: string; price: number | null; open: boolean };
  sizing: BaseSizing;
  /** USD a day the hedge costs (negative: it is being paid) at today's funding and borrow rates. */
  carryPerDayUsd: number;
}

export async function quote(inputs: BasePlanInputs): Promise<AgentQuote> {
  const [m, price] = await Promise.all([getMarket(inputs.pairIndex), getSignedPrice(inputs.pairIndex).catch(() => null)]);
  let sizing: BaseSizing;
  try {
    sizing = sizeBasePlan(inputs, marketTerms(m));
  } catch (e) {
    if (e instanceof BasePlanError) throw new HttpError(400, e.message);
    throw e;
  }
  return {
    inputs,
    market: { symbol: m.symbol, price: price?.price ?? null, open: m.marketOpen && !m.closeOnly },
    sizing,
    carryPerDayUsd: Math.round(verantaCarryPerDay(m, sizing.buy, sizing.notionalUsd) * 100) / 100,
  };
}

/** The calls the owner's wallet sends, in order (one batch with wallet_sendCalls). */
export async function planCalls(ownerRaw: unknown, inputs: BasePlanInputs) {
  if (typeof ownerRaw !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(ownerRaw)) throw new HttpError(400, "owner must be the address that will own the vault");
  const owner = getAddress(ownerRaw);
  const factory = requireFactory();
  const q = await quote(inputs);
  const deposit = usdcUnits(q.sizing.depositUsd);
  const plan = {
    enabled: true,
    buy: q.sizing.buy,
    maxLeverage: BigInt(Math.round(q.sizing.limits.maxLeverage * 1e10)),
    maxNotional: usdcUnits(q.sizing.limits.maxNotionalUsd),
  };
  // Locke's Builder Code rides on the calldata, as in the app (ERC-8021; contracts ignore it).
  const suffix = builderSuffix(config.baseBuilderCode);
  const withCode = (data: Hex) => (suffix ? concatHex([data, suffix]) : data);
  const calls: { to: Address; data: Hex; value: "0x0"; description: string }[] = [
    { to: USDC, data: withCode(encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [factory, deposit] })), value: "0x0", description: `Approve ${q.sizing.depositUsd} USDC for Locke's vault factory` },
    { to: factory, data: withCode(encodeFunctionData({ abi: factoryAbi, functionName: "createVault", args: [BigInt(inputs.pairIndex), plan, deposit] })), value: "0x0", description: "Create the vault, owned by the sender, with these limits and deposit" },
  ];
  return {
    ...q,
    owner,
    chainId: 8453,
    calls,
    next: "Send the calls from the owner's wallet (wallet_sendCalls, or one transaction each in order), then POST the createVault transaction hash and these inputs to /api/agent/vaults.",
  };
}
