// Locke on Base vaults: recording a vault the business created, and reading its live state from
// Base (vault contract) and Veranta (the hedge position).

import { decodeEventLog, getAddress, isAddressEqual, parseAbiItem, type Address, type Hex } from "viem";
import { baseMarket, erc20Abi, factoryAbi, fromUsdcUnits, P10, USDC, usdcUnits, vaultAbi } from "../base/contracts";
import { BasePlanError, parseBaseInputs, planLimits, planName, sizeBasePlan, type BaseSizing } from "../domain/basePlans";
import { verantaLiquidationPrice, verantaMarginRatio, verantaPnl, type VerantaMarket, type VerantaPosition } from "../domain/veranta";
import { getMarket, getPositions, getSignedPrice } from "../veranta/client";
import { basePublicClient } from "./baseChain";
import { incomeFor, type IncomeView } from "./baseIncome";
import { config } from "./config";
import { db } from "./db";
import { HttpError } from "./errors";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const VAULT_CREATED = parseAbiItem("event VaultCreated(address indexed owner, address indexed vault, uint256 indexed pairIndex, bool buy, uint128 maxNotional, uint16 feeBps)");

export function requireFactory(): Address {
  const f = config.baseFactoryAddress;
  if (!f) throw new HttpError(503, "Locke isn't live yet.");
  return f;
}

export function marketTerms(m: VerantaMarket) {
  return { minPositionUsd: m.minPositionUsd, maxLeverage: m.maxLeverage, openFeePct: m.openFeePct, closeFeePct: m.closeFeePct, spreadPct: m.spreadPct };
}

/** The address that created a vault through Locke's factory in this transaction (the VaultCreated owner). */
export async function vaultCreator(txHash: string): Promise<Address> {
  const factory = requireFactory();
  const receipt = await basePublicClient().getTransactionReceipt({ hash: txHash as Hex }).catch(() => null);
  if (!receipt) throw new HttpError(404, "That transaction isn't on Base yet. Try again in a moment.");
  for (const l of receipt.logs) {
    if (!isAddressEqual(l.address, factory)) continue;
    try {
      return decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics, eventName: "VaultCreated" }).args.owner;
    } catch {
      /* another factory event */
    }
  }
  throw new HttpError(400, "That transaction didn't create a Locke vault");
}

/**
 * Record a vault from the transaction that created it. The VaultCreated event must come from
 * Locke's factory, name this user as owner, and carry exactly the limits these inputs give,
 * so the record can't claim someone else's vault or a plan that differs from what is on chain.
 */
export async function recordVault(user: { uid: string; addr: string }, txHash: string, rawInputs: unknown, via: "app" | "agent" = "app") {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new HttpError(400, "Invalid transaction hash");
  const factory = requireFactory();
  let inputs;
  try {
    inputs = parseBaseInputs(rawInputs);
  } catch (e) {
    if (e instanceof BasePlanError) throw new HttpError(400, e.message);
    throw e;
  }
  const client = basePublicClient();
  const receipt = await client.getTransactionReceipt({ hash: txHash as Hex }).catch(() => null);
  if (!receipt) throw new HttpError(404, "That transaction isn't on Base yet. Try again in a moment.");
  if (receipt.status !== "success") throw new HttpError(400, "That transaction failed on Base");

  const created = receipt.logs
    .filter((l) => isAddressEqual(l.address, factory))
    .map((l) => {
      try {
        return decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics, eventName: "VaultCreated" }).args;
      } catch {
        return null;
      }
    })
    .find((a) => a !== null);
  if (!created) throw new HttpError(400, "That transaction didn't create a Locke vault");
  if (!isAddressEqual(created.owner, user.addr as Address)) throw new HttpError(403, "That vault belongs to another account");

  const limits = planLimits(inputs);
  const market = baseMarket(inputs.pairIndex)!;
  const plan = await client.readContract({ address: created.vault, abi: vaultAbi, functionName: "plans", args: [BigInt(inputs.pairIndex)] });
  const [enabled, buy, maxLeverage, maxNotional, maxCollateral] = plan;
  if (
    Number(created.pairIndex) !== inputs.pairIndex ||
    !enabled ||
    buy !== market.buy ||
    maxLeverage !== BigInt(Math.round(limits.maxLeverage * 1e10)) ||
    maxNotional !== usdcUnits(limits.maxNotionalUsd) ||
    maxCollateral !== usdcUnits(limits.maxCollateralUsd)
  ) {
    throw new HttpError(400, "The vault's limits on Base don't match this plan");
  }

  // The vault exists on Base whatever Avantis's terms are now, so a changed minimum size or
  // leverage cap must not stop it being recorded: size it with those limits relaxed (the keeper's
  // open is still checked by Avantis). Avantis being unreachable is a 503 the page retries.
  const terms = marketTerms(await getMarket(inputs.pairIndex));
  const sizing: BaseSizing = sizeBasePlan(inputs, { ...terms, minPositionUsd: 0, maxLeverage: Math.max(terms.maxLeverage, inputs.leverage) });
  const vault = created.vault.toLowerCase();
  // The agent API registers without a session, so anyone who sees the transaction could register
  // it first with other inputs that give the same limits. The owner's own signed-in save wins.
  const inserted = await db()`
    insert into base_vaults (address, user_id, pair_index, type, name, inputs, sizing, created_tx, created_via)
    values (${vault}, ${user.uid}, ${inputs.pairIndex}, ${inputs.type}, ${planName(inputs)}, ${db().json(inputs as never)}, ${db().json(sizing as never)}, ${txHash.toLowerCase()}, ${via})
    on conflict (address) do update set inputs = excluded.inputs, sizing = excluded.sizing, name = excluded.name, created_via = 'app', updated_at = now()
      where base_vaults.created_via = 'agent' and excluded.created_via = 'app' and base_vaults.status in ('funding', 'opening')
    returning address, (xmax = 0) as fresh`;
  // Recording again (a retry, or the same hash sent twice) adds nothing.
  const fresh = inserted.length > 0 && inserted[0].fresh;
  if (fresh) await addVaultEvent(vault, "info", "Vault created on Base", { tx: txHash });
  return { address: vault, created: fresh };
}

export async function addVaultEvent(vault: string, level: string, message: string, detail?: Record<string, unknown>, txHash?: string) {
  await db()`
    insert into base_vault_events (vault, level, message, detail, tx_hash)
    values (${vault}, ${level}, ${message}, ${detail ? db().json(detail as never) : null}, ${txHash ?? null})`;
}

/**
 * The vault's live "Protected by Locke" attestation: the latest one the keeper issued (an event
 * whose detail names it) that no later event has revoked. Null when there is none.
 */
export async function activeAttestation(vault: string): Promise<string | null> {
  const [row] = await db()`
    select e.detail->>'attestation' as uid from base_vault_events e
    where e.vault = ${vault.toLowerCase()} and e.detail ? 'attestation'
      and not exists (select 1 from base_vault_events r where r.vault = e.vault and r.detail->>'revoked' = e.detail->>'attestation')
    order by e.id desc limit 1`;
  return (row?.uid as string | undefined) ?? null;
}

/** Save what a business asked for just before its wallet creates the vault (see recoverVaults). */
export async function saveDraft(uid: string, rawInputs: unknown) {
  let inputs;
  try {
    inputs = parseBaseInputs(rawInputs);
  } catch (e) {
    if (e instanceof BasePlanError) throw new HttpError(400, e.message);
    throw e;
  }
  await db()`insert into base_vault_drafts (user_id, inputs) values (${uid}, ${db().json(inputs as never)})`;
  // Only the latest few are ever needed.
  await db()`delete from base_vault_drafts where user_id = ${uid} and id not in (select id from base_vault_drafts where user_id = ${uid} order by id desc limit 10)`;
}

/**
 * Vaults this account created on Base that Locke has no record of (the page closed, or saving
 * failed, before the vault was recorded): each is recorded from its creation transaction with
 * the saved draft whose limits match it on chain. Never throws: the portfolio shows what it has.
 */
export async function recoverVaults(user: { uid: string; addr: string }): Promise<void> {
  const factory = config.baseFactoryAddress;
  if (!factory) return;
  try {
    const client = basePublicClient();
    const onChain = (await client.readContract({ address: factory, abi: factoryAbi, functionName: "vaultsOf", args: [user.addr as Address] })) as Address[];
    if (onChain.length === 0) return;
    const known = new Set((await db()`select address from base_vaults where address in ${db()(onChain.map((a) => a.toLowerCase()))}`).map((r) => r.address as string));
    const missing = onChain.filter((a) => !known.has(a.toLowerCase()));
    if (missing.length === 0) return;
    const drafts = await db()`select inputs from base_vault_drafts where user_id = ${user.uid} order by id desc limit 10`;
    for (const vault of missing.slice(0, 3)) {
      const block = (await client.readContract({ address: factory, abi: factoryAbi, functionName: "createdAtBlock", args: [vault] })) as bigint;
      const [log] = await client.getLogs({ address: factory, event: VAULT_CREATED, args: { vault }, fromBlock: block, toBlock: block });
      if (!log?.transactionHash || log.args.pairIndex == null) continue;
      const pair = Number(log.args.pairIndex);
      const [, , maxLeverage, maxNotional, maxCollateral] = await client.readContract({ address: vault, abi: vaultAbi, functionName: "plans", args: [BigInt(pair)] });
      const match = drafts.find((d) => {
        try {
          const i = parseBaseInputs(d.inputs);
          const l = planLimits(i);
          return (
            i.pairIndex === pair &&
            BigInt(Math.round(l.maxLeverage * 1e10)) === maxLeverage &&
            usdcUnits(l.maxNotionalUsd) === maxNotional &&
            usdcUnits(l.maxCollateralUsd) === maxCollateral
          );
        } catch {
          return false;
        }
      });
      if (!match) {
        console.warn("[recover] vault on Base with no matching draft", vault, "for", user.addr);
        continue;
      }
      await recordVault(user, log.transactionHash, match.inputs);
      console.log("[recover] recorded", vault, "for", user.addr);
    }
  } catch (e) {
    console.warn("[recover] couldn't check Base for unsaved vaults:", (e as Error).message);
  }
}

export async function listVaults(uid: string) {
  return db()`
    select address, pair_index, type, name, status, risk_level, last_ratio, sizing, created_at
    from base_vaults where user_id = ${uid} order by created_at desc`;
}

export interface VaultView {
  address: string;
  name: string;
  type: string;
  status: string;
  riskLevel: string;
  statusNote: string | null;
  pairIndex: number;
  symbol: string;
  buy: boolean;
  sizing: BaseSizing;
  chain: {
    owner: string;
    keeper: string;
    paused: boolean;
    feeBps: number;
    idleUsd: number;
    netDepositsUsd: number;
    limits: { enabled: boolean; maxLeverage: number; maxNotionalUsd: number; maxCollateralUsd: number };
    /** The keeper is Locke's (the factory's, followed automatically). */
    keeperFollowsFactory: boolean;
    /** Someone the owner named and who hasn't accepted yet. */
    pendingOwner: string | null;
  } | null;
  /** P&L and margin used are null while there is no price to value the hedge at. */
  position: (VerantaPosition & { pnlUsd: number | null; ratio: number | null; liquidationPrice: number }) | null;
  mark: number | null;
  marketOpen: boolean | null;
  events: { id: number; level: string; message: string; txHash: string | null; at: string }[];
  /** The live "Protected by Locke" attestation on Base, if the hedge is open and it has been issued. */
  attestation: string | null;
  /** "Protect as you get paid", when the owner has turned it on at some point. */
  income: IncomeView | null;
  /** Something couldn't be read (Base or Veranta down); the rest is still shown. */
  partial: string[];
}

/** A vault's state for its owner: the record, the vault on Base, the hedge on Veranta. */
export async function vaultDetail(uid: string, address: string): Promise<VaultView> {
  if (!ADDRESS.test(address)) throw new HttpError(404, "Vault not found");
  const vault = address.toLowerCase();
  const [row] = await db()`select * from base_vaults where address = ${vault} and user_id = ${uid}`;
  if (!row) throw new HttpError(404, "Vault not found");
  const market = baseMarket(Number(row.pair_index))!;
  const partial: string[] = [];
  const v = getAddress(vault);
  const client = basePublicClient();
  const read = <T>(fn: string, args: unknown[] = [], abi: unknown = vaultAbi, to: Address = v) =>
    client.readContract({ address: to, abi: abi as typeof vaultAbi, functionName: fn as never, args: args as never }) as Promise<T>;

  const [chain, positions, price, m] = await Promise.all([
    Promise.all([
      read<string>("owner"),
      read<string>("keeper"),
      read<boolean>("paused"),
      read<number>("feeBps"),
      read<bigint>("balanceOf", [v], erc20Abi, USDC),
      read<bigint>("netDeposits"),
      read<readonly [boolean, boolean, bigint, bigint, bigint]>("plans", [BigInt(market.pairIndex)]),
      read<boolean>("keeperFollowsFactory"),
      read<string>("pendingOwner"),
    ]).catch(() => {
      partial.push("Base");
      return null;
    }),
    getPositions(vault, { pairIndex: market.pairIndex }).catch(() => {
      partial.push("Avantis");
      return null;
    }),
    getSignedPrice(market.pairIndex, { forDisplay: true }).catch(() => null),
    getMarket(market.pairIndex).catch(() => null),
  ]);

  const pos = positions?.find((p) => p.pairIndex === market.pairIndex) ?? null;
  const mark = price?.price ?? null;
  const [events, attestation, income] = await Promise.all([
    db()`select id, level, message, tx_hash, created_at from base_vault_events where vault = ${vault} order by id desc limit 30`,
    activeAttestation(vault),
    incomeFor(vault),
  ]);

  return {
    address: vault,
    name: row.name,
    type: row.type,
    status: row.status,
    riskLevel: row.risk_level,
    statusNote: row.status_note,
    pairIndex: market.pairIndex,
    symbol: market.symbol,
    buy: market.buy,
    sizing: row.sizing,
    chain: chain && {
      owner: chain[0].toLowerCase(),
      keeper: chain[1].toLowerCase(),
      paused: chain[2],
      feeBps: Number(chain[3]),
      idleUsd: fromUsdcUnits(chain[4]),
      netDepositsUsd: fromUsdcUnits(chain[5]),
      limits: {
        enabled: chain[6][0],
        maxLeverage: Number(chain[6][2]) / Number(P10),
        maxNotionalUsd: fromUsdcUnits(chain[6][3]),
        maxCollateralUsd: fromUsdcUnits(chain[6][4]),
      },
      keeperFollowsFactory: chain[7],
      pendingOwner: /^0x0{40}$/i.test(chain[8]) ? null : chain[8].toLowerCase(),
    },
    position:
      pos && {
        ...pos,
        pnlUsd: mark == null ? null : verantaPnl(pos, mark) - pos.rolloverFeeUsd - pos.fundingFeeUsd,
        ratio: mark == null ? null : Math.min(verantaMarginRatio(pos, mark), 10),
        liquidationPrice: pos.liquidationPrice || verantaLiquidationPrice(pos),
      },
    mark,
    marketOpen: m ? m.marketOpen : null,
    events: events.map((e) => ({ id: Number(e.id), level: e.level, message: e.message, txHash: e.tx_hash, at: new Date(e.created_at).toISOString() })),
    attestation,
    income,
    partial,
  };
}
