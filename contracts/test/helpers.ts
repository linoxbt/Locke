import { encodeAbiParameters, keccak256, pad, toHex, type Address, type Hex } from "viem";

/** Veranta (formerly Avantis) on Base mainnet, from tx-builder.veranta.xyz/v2/meta. */
export const VERANTA = {
  router: "0x44914408af82bC9983bbb330e3578E1105e11d4e" as Address,
  storage: "0x8a311D7048c35985aa31C131B9A13e03a5f7422d" as Address,
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
  feed: "https://feed-v3.veranta.xyz",
};

export const PAIR = { ETH: 0n, WTI: 96n } as const;
export const SOURCING = { PYTH_CORE: 0, PYTH_LAZER: 1 } as const;
/** Fixed-point units used by Veranta. */
export const P10 = 10n ** 10n;
export const USD = (n: number) => BigInt(Math.round(n * 1e6));

/** A signed Pyth Lazer price for a pair, as Veranta's own keepers post it. */
export async function priceUpdate(pairIndex: bigint): Promise<{ data: Hex; price: bigint; publishMs: number }> {
  const res = await fetch(`${VERANTA.feed}/v2/pairs/${pairIndex}/price-update-data`);
  if (!res.ok) throw new Error(`feed ${res.status}`);
  const body = (await res.json()) as { pro?: { priceUpdateData: Hex; price: number; publishTimestampMs: number } };
  if (!body.pro) throw new Error(`no Lazer price for pair ${pairIndex} (market closed?)`);
  return { data: body.pro.priceUpdateData, price: BigInt(Math.round(body.pro.price * 1e10)), publishMs: body.pro.publishTimestampMs };
}

/** Storage slot of `balanceAndBlacklistStates[holder]` in Circle's FiatToken v2.2 (mapping at slot 9). */
export function usdcBalanceSlot(holder: Address): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, 9n]));
}

export const asSlotValue = (n: bigint): Hex => pad(toHex(n), { size: 32 });

/** No spread: the order fills at the oracle price, so the test checks the vault, not Veranta's spread model. */
export const NO_SPREAD = { spreadP: 0n, bookDepth: 0n, impactParam: 0n, byPass: true, maxSpreadP: 0n, slot_1: false, slot_3: 0n };

export async function expectRevert(p: Promise<unknown>, name: string) {
  try {
    await p;
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (msg.includes(name)) return;
    throw new Error(`expected revert ${name}, got: ${msg.slice(0, 400)}`);
  }
  throw new Error(`expected revert ${name}, but it succeeded`);
}
