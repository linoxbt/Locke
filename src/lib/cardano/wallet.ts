"use client";

// CIP-30 wallet access (Eternl, Lace, Vespr, ...). Browser only.

import { addressToBech32, stakeFromBaseAddress, walletAddressBytes } from "./bech32";
import { bytesToHex, utf8ToHex } from "./bytes";
import { decodeLovelace, mergeWitnesses } from "./cbor";

// Wallets differ in how much of CIP-30 they implement (OKX and SubWallet skip some methods), so
// everything beyond what Locke strictly needs is optional and has a fallback.
export interface Cip30Api {
  getNetworkId(): Promise<number>;
  getBalance?(): Promise<string>;
  getUtxos(): Promise<string[] | null>;
  getChangeAddress?(): Promise<string>;
  getUsedAddresses?(): Promise<string[]>;
  getUnusedAddresses?(): Promise<string[]>;
  getRewardAddresses?(): Promise<string[]>;
  signData(addr: string, payload: string): Promise<{ signature: string; key: string }>;
  signTx(tx: string, partialSign?: boolean): Promise<string>;
  submitTx(tx: string): Promise<string>;
}

const WORKING = "Try Eternl, Lace or Vespr.";

/** Call an optional CIP-30 method; a missing method or a refusal gives undefined. */
async function optional<T>(fn: (() => Promise<T>) | undefined): Promise<T | undefined> {
  if (typeof fn !== "function") return undefined;
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

/** The wallet's payment address: change address, else first used, else first unused. */
async function paymentAddress(api: Cip30Api): Promise<Uint8Array> {
  const candidates = [
    await optional(api.getChangeAddress?.bind(api)),
    (await optional(api.getUsedAddresses?.bind(api)))?.[0],
    (await optional(api.getUnusedAddresses?.bind(api)))?.[0],
  ];
  for (const c of candidates) {
    if (!c) continue;
    try {
      return walletAddressBytes(c);
    } catch {
      /* unreadable format: try the next one */
    }
  }
  throw new Error(`This wallet didn't share an address with Locke. ${WORKING}`);
}

export interface WalletOption {
  id: string;
  name: string;
  icon?: string;
}

export const EXPECTED_NETWORK_ID = Number(process.env.NEXT_PUBLIC_CARDANO_NETWORK_ID ?? "1");

const KNOWN = ["eternl", "lace", "vespr", "nami", "gerowallet", "yoroi", "typhoncip30", "nufi", "begin", "tokeo", "okxwallet"];

declare global {
  interface Window {
    cardano?: Record<string, { name?: string; icon?: string; enable?: () => Promise<Cip30Api> }>;
  }
}

export function detectWallets(): WalletOption[] {
  if (typeof window === "undefined" || !window.cardano) return [];
  const ids = new Set([...KNOWN, ...Object.keys(window.cardano)]);
  const out: WalletOption[] = [];
  for (const id of ids) {
    const ns = window.cardano[id];
    if (ns && typeof ns.enable === "function" && !out.some((w) => w.name === (ns.name ?? id))) {
      out.push({ id, name: ns.name ?? id, icon: ns.icon });
    }
  }
  return out;
}

export interface ConnectedWallet {
  id: string;
  api: Cip30Api;
  address: string;
  addressHex: string;
  stakeAddress: string | null;
}

export async function enableWallet(id: string): Promise<ConnectedWallet> {
  const ns = window.cardano?.[id];
  if (!ns?.enable) throw new Error("Wallet not found. Install a Cardano wallet extension.");
  const api = await ns.enable();
  for (const m of ["getNetworkId", "getUtxos", "signData", "signTx", "submitTx"] as const) {
    if (typeof api[m] !== "function") throw new Error(`This wallet can't do what Locke needs (${m} is missing). ${WORKING}`);
  }
  const networkId = await api.getNetworkId();
  if (networkId !== EXPECTED_NETWORK_ID) {
    throw new Error(
      EXPECTED_NETWORK_ID === 1 ? "Switch your wallet to Cardano mainnet." : "Switch your wallet to the Preprod testnet."
    );
  }
  const addrBytes = await paymentAddress(api);
  const address = addressToBech32(addrBytes, networkId);
  const reward = (await optional(api.getRewardAddresses?.bind(api)))?.[0];
  let stakeBytes: Uint8Array | null = null;
  try {
    stakeBytes = reward ? walletAddressBytes(reward) : null;
  } catch {
    stakeBytes = null;
  }
  // Wallets without getRewardAddresses: the stake key is inside the base address.
  stakeBytes ??= stakeFromBaseAddress(addrBytes);
  const stakeAddress = stakeBytes ? addressToBech32(stakeBytes, networkId) : null;
  return { id, api, address, addressHex: bytesToHex(addrBytes), stakeAddress };
}

/** ADA in the wallet (whole ADA, floored). */
export async function walletAda(w: ConnectedWallet): Promise<number> {
  if (typeof w.api.getBalance !== "function") throw new Error("This wallet doesn't report its balance");
  const lovelace = decodeLovelace(await w.api.getBalance());
  return Number(lovelace / BigInt(1_000_000));
}

/** Sign plain text (Strike challenge) → "coseSign1Hex:coseKeyHex". */
export async function signText(w: ConnectedWallet, text: string, alreadyHex = false): Promise<string> {
  const { signature, key } = await w.api.signData(w.addressHex, alreadyHex ? text : utf8ToHex(text));
  return `${signature}:${key}`;
}

export async function walletUtxos(w: ConnectedWallet): Promise<string[]> {
  const utxos = await w.api.getUtxos();
  if (!utxos?.length) throw new Error("Your wallet has no spendable ADA.");
  return utxos;
}

/** Sign Strike's unsigned deposit transaction, attach witnesses and submit. Returns the tx hash. */
export async function signAndSubmit(w: ConnectedWallet, unsignedTx: string): Promise<string> {
  const witnesses = await w.api.signTx(unsignedTx, true);
  const signed = mergeWitnesses(unsignedTx, witnesses);
  return w.api.submitTx(signed);
}
