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

type WalletCall = "enable" | "signData" | "signTx" | "submitTx";

/**
 * CIP-30 errors are {code, info} objects whose codes mean different things per method:
 * signData 3 and signTx 2 are the user declining, but submitTx 2 is a failed submission and
 * signData 2 an address the wallet can't sign for. APIError -3 is a refusal, -4 an account change.
 */
export function walletError(e: unknown, call: WalletCall): Error {
  const { code, info, message } = (e ?? {}) as { code?: number; info?: string; message?: string };
  const text = info || message || (typeof e === "string" ? e : "");
  const err = translate(code, text, call);
  // The wallet's own words, for the cases where Locke's translation isn't the whole story.
  (err as WalletErr).walletText = text;
  (err as WalletErr).refused = err.message === CANCELLED || err.message === NOT_ALLOWED;
  return err;
}

type WalletErr = Error & { walletText?: string; refused?: boolean };
const CANCELLED = "Request cancelled in your wallet.";
const NOT_ALLOWED = "You didn't let Locke see your wallet. Approve the connection to continue.";

function translate(code: number | undefined, text: string, call: WalletCall): Error {
  // OKX says "User denied request signature" (code 4001, as on EVM chains).
  if (code === -3 || code === 4001 || (call === "signData" && code === 3) || (call === "signTx" && code === 2) || /declin|reject|cancel|denied/i.test(text)) {
    return new Error(call === "enable" ? NOT_ALLOWED : CANCELLED);
  }
  if (code === -4) return new Error("The account in your wallet changed. Switch back, or sign in again.");
  if (call === "signData" && code === 2) return new Error("Your wallet can't sign with this address. Pick your main account in the wallet and try again.");
  if (call === "submitTx") return new Error(`Your wallet couldn't submit the transaction${text ? `: ${text}` : ""}. Nothing was sent; try again.`);
  return new Error(text || "Your wallet reported an error. Try again.");
}

async function wallet<T>(call: WalletCall, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw walletError(e, call);
  }
}

/** Call an optional CIP-30 method; a missing method or a refusal gives undefined. */
async function optional<T>(fn: (() => Promise<T>) | undefined): Promise<T | undefined> {
  if (typeof fn !== "function") return undefined;
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

/**
 * The wallet's payment address: change address, else first used, else first unused. Returns the
 * bytes and the string exactly as the wallet gave it (hex per CIP-30, bech32 in some wallets).
 */
async function paymentAddress(api: Cip30Api): Promise<{ bytes: Uint8Array; raw: string }> {
  const candidates = [
    await optional(api.getChangeAddress?.bind(api)),
    (await optional(api.getUsedAddresses?.bind(api)))?.[0],
    (await optional(api.getUnusedAddresses?.bind(api)))?.[0],
  ];
  for (const c of candidates) {
    if (!c) continue;
    try {
      return { bytes: walletAddressBytes(c), raw: c.trim() };
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
  /** The address string exactly as the wallet returned it; some wallets (OKX) only sign for that form. */
  addressRaw?: string;
  stakeAddress: string | null;
}

export async function enableWallet(id: string): Promise<ConnectedWallet> {
  const ns = window.cardano?.[id];
  if (!ns?.enable) throw new Error("Wallet not found. Install a Cardano wallet extension.");
  const api = await enableOnce(ns.enable.bind(ns)).catch(async (e: WalletErr) => {
    // A refusal faster than a person can react usually means the wallet was still busy with an
    // earlier request (OKX does this). Ask once more before giving up.
    if (!e.refused || !(e as WalletErr & { instant?: boolean }).instant) throw e;
    await new Promise((r) => setTimeout(r, 700));
    return enableOnce(ns.enable!.bind(ns)).catch((e2: WalletErr & { instant?: boolean }) => {
      if (e2.refused && e2.instant) {
        throw new Error(
          `Your wallet refused the connection without asking you. Open it, unlock it, make sure it has a Cardano account on mainnet, then try again.${said(e2)} ${WORKING}`
        );
      }
      throw e2;
    });
  });
  for (const m of ["getNetworkId", "getUtxos", "signData", "signTx", "submitTx"] as const) {
    if (typeof api[m] !== "function") throw new Error(`This wallet can't do what Locke needs (${m} is missing). ${WORKING}`);
  }
  // OKX documents the network id as a string.
  const networkId = Number(await api.getNetworkId());
  if (networkId !== EXPECTED_NETWORK_ID) {
    throw new Error(
      EXPECTED_NETWORK_ID === 1 ? "Switch your wallet to Cardano mainnet." : "Switch your wallet to the Preprod testnet."
    );
  }
  const { bytes: addrBytes, raw: addressRaw } = await paymentAddress(api);
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
  return { id, api, address, addressHex: bytesToHex(addrBytes), addressRaw, stakeAddress };
}

/** Faster than anyone can read a wallet window and press Reject: the wallet answered on its own. */
const INSTANT_REFUSAL_MS = 1200;

async function enableOnce(enable: () => Promise<Cip30Api>): Promise<Cip30Api> {
  const started = Date.now();
  try {
    return await wallet("enable", enable);
  } catch (e) {
    (e as WalletErr & { instant?: boolean }).instant = Date.now() - started < INSTANT_REFUSAL_MS;
    throw e;
  }
}

function said(e: WalletErr): string {
  return e.walletText ? ` (Your wallet said: "${e.walletText.slice(0, 120)}")` : "";
}

/** ADA in the wallet (whole ADA, floored). */
export async function walletAda(w: ConnectedWallet): Promise<number> {
  if (typeof w.api.getBalance !== "function") throw new Error("This wallet doesn't report its balance");
  const lovelace = decodeLovelace(await w.api.getBalance());
  return Number(lovelace / BigInt(1_000_000));
}

/**
 * Sign plain text (Strike challenge) → "coseSign1Hex:coseKeyHex". CIP-30 says the address is hex,
 * but wallets differ: OKX signs for the address string exactly as it returned it. Locke tries the
 * wallet's own form first, then hex, then bech32 — moving on only when the wallet answered
 * instantly (it rejected the address, nobody pressed anything), so a person who declines is
 * never asked twice.
 */
export async function signText(w: ConnectedWallet, text: string, alreadyHex = false): Promise<string> {
  const payload = alreadyHex ? text : utf8ToHex(text);
  const forms = [...new Set([w.addressRaw, w.addressHex, w.address].filter((a): a is string => !!a))];
  let last: WalletErr | null = null;
  for (const addr of forms) {
    const started = Date.now();
    try {
      const { signature, key } = await wallet("signData", () => w.api.signData(addr, payload));
      return `${signature}:${key}`;
    } catch (e) {
      last = e as WalletErr;
      if (Date.now() - started >= INSTANT_REFUSAL_MS) throw e; // a person saw the request and declined it
    }
  }
  if (last?.refused) {
    throw new Error(
      `Your wallet refused to sign without showing a signature window. Unlock it, check it's on Cardano mainnet with this account selected, and try again.${said(last)} ${WORKING}`
    );
  }
  throw last ?? new Error("Your wallet couldn't sign. Try again.");
}

export async function walletUtxos(w: ConnectedWallet): Promise<string[]> {
  const utxos = await w.api.getUtxos();
  if (!utxos?.length) throw new Error("Your wallet has no spendable ADA.");
  return utxos;
}

/** Sign Strike's unsigned deposit transaction, attach witnesses and submit. Returns the tx hash. */
export async function signAndSubmit(w: ConnectedWallet, unsignedTx: string): Promise<string> {
  const signed = await signFull(w, unsignedTx);
  return wallet("submitTx", () => w.api.submitTx(signed));
}

/** Sign a transaction someone else built and return it with the wallet's witnesses attached. */
export async function signFull(w: ConnectedWallet, unsignedTx: string): Promise<string> {
  const witnesses = await wallet("signTx", () => w.api.signTx(unsignedTx, true));
  return mergeWitnesses(unsignedTx, witnesses);
}
