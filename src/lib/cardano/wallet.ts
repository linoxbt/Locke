"use client";

// CIP-30 wallet access (Eternl, Lace, Vespr, ...). Browser only.

import { addressToBech32 } from "./bech32";
import { hexToBytes, utf8ToHex } from "./bytes";
import { decodeLovelace, mergeWitnesses } from "./cbor";

export interface Cip30Api {
  getNetworkId(): Promise<number>;
  getBalance(): Promise<string>;
  getUtxos(): Promise<string[] | null>;
  getChangeAddress(): Promise<string>;
  getUsedAddresses(): Promise<string[]>;
  getRewardAddresses(): Promise<string[]>;
  signData(addr: string, payload: string): Promise<{ signature: string; key: string }>;
  signTx(tx: string, partialSign?: boolean): Promise<string>;
  submitTx(tx: string): Promise<string>;
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
  const networkId = await api.getNetworkId();
  if (networkId !== EXPECTED_NETWORK_ID) {
    throw new Error(
      EXPECTED_NETWORK_ID === 1 ? "Switch your wallet to Cardano mainnet." : "Switch your wallet to the Preprod testnet."
    );
  }
  const addressHex = await api.getChangeAddress();
  const address = addressToBech32(hexToBytes(addressHex), networkId);
  const rewards = await api.getRewardAddresses().catch(() => [] as string[]);
  const stakeAddress = rewards?.[0] ? addressToBech32(hexToBytes(rewards[0]), networkId) : null;
  return { id, api, address, addressHex, stakeAddress };
}

/** ADA in the wallet (whole ADA, floored). */
export async function walletAda(w: ConnectedWallet): Promise<number> {
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
