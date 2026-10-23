"use client";

// CIP-30 wallet access (Eternl, Lace, Vespr, ...). Browser only.

import { addressToBech32, bech32Decode, stakeFromBaseAddress, walletAddressBytes } from "./bech32";
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
  const err = translate(code, text, call) as WalletErr;
  // The wallet's own words, for the cases where Locke's translation isn't the whole story.
  err.walletText = text;
  err.code = code;
  err.refused = err.message === CANCELLED || err.message === NOT_ALLOWED;
  return err;
}

type WalletErr = Error & { walletText?: string; refused?: boolean; code?: number };
const CANCELLED = "Request cancelled in your wallet.";
const NOT_ALLOWED = "You didn't let Locke see your wallet. Approve the connection to continue.";
const ACCOUNT_CHANGED = "The account in your wallet changed. Switch back, or sign in again.";
/** A wallet that is still showing (or silently holding) an earlier request refuses new ones. */
const STILL_OPEN = "If it didn't ask you, an earlier wallet request may still be open: close it in your wallet and try again.";

function translate(code: number | undefined, text: string, call: WalletCall): Error {
  // A node refusing the transaction ("transaction rejected: BadInputsUTxO") is a failed
  // submission, not the user cancelling, so submitTx never reads the wallet's wording.
  if (call === "submitTx") {
    if (code === -4) return new Error(ACCOUNT_CHANGED);
    return new Error(`Your wallet couldn't submit the transaction${text ? `: ${text}` : ""}. Nothing was sent; try again.`);
  }
  // OKX says "User denied request signature" (code 4001, as on EVM chains).
  if (code === -3 || code === 4001 || (call === "signData" && code === 3) || (call === "signTx" && code === 2) || /declin|reject|cancel|denied/i.test(text)) {
    return new Error(call === "enable" ? NOT_ALLOWED : CANCELLED);
  }
  if (code === -4) return new Error(ACCOUNT_CHANGED);
  if (call === "signData" && code === 2) return new Error("Your wallet can't sign with this address. Pick your main account in the wallet and try again.");
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

type Cip30Provider = { name?: string; icon?: string; enable?: () => Promise<Cip30Api> };

declare global {
  interface Window {
    cardano?: Record<string, Cip30Provider>;
    okxwallet?: { cardano?: Cip30Provider };
  }
}

/** The CIP-30 provider for a wallet id. OKX's own namespace wins over its window.cardano entry. */
function provider(id: string): Cip30Provider | undefined {
  if (id === "okxwallet" && typeof window.okxwallet?.cardano?.enable === "function") return window.okxwallet.cardano;
  return window.cardano?.[id];
}

export function detectWallets(): WalletOption[] {
  if (typeof window === "undefined" || (!window.cardano && !window.okxwallet?.cardano)) return [];
  const ids = new Set([...KNOWN, ...Object.keys(window.cardano ?? {})]);
  const out: WalletOption[] = [];
  for (const id of ids) {
    const ns = provider(id);
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

// One enable() per wallet at a time: some wallets (OKX) refuse a request while another is pending,
// so concurrent callers share the one already on its way.
const enabling = new Map<string, Promise<ConnectedWallet>>();

/** Ask the wallet for access (CIP-30 enable). Call it from a user action: wallets may refuse otherwise. */
export function enableWallet(id: string): Promise<ConnectedWallet> {
  const pending = enabling.get(id);
  if (pending) return pending;
  const p = connect(id).finally(() => enabling.delete(id));
  enabling.set(id, p);
  return p;
}

/**
 * OKX Wallet (extension 4.21) runs every connect through a focus check before showing anything: its
 * background compares chrome.tabs.query({active: true}) with chrome.windows.getLastFocused(), and if
 * this page's tab isn't the active tab of the window it thinks is focused, it rejects at once with
 * EVM's 4001 "Request Signature: User denied request signature." No window opens and nobody is asked.
 * Mobile browsers that run extensions report tabs and windows in a way that fails this check every
 * time. A person can't open OKX's window and press Reject this fast, so a 4001 inside this window of
 * time is OKX's own block, not the user.
 */
const OKX_FOCUS_BLOCK_MS = 400;

export function isMobileBrowser(): boolean {
  return typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/** The OKX app's built-in browser (its user agent carries "OKApp"). */
export function isOkxApp(): boolean {
  return typeof navigator !== "undefined" && /OKApp/i.test(navigator.userAgent);
}

/**
 * Why OKX can't sign in to a Cardano site here, or null when it can. OKX supports Cardano sites in
 * its desktop browser extension only: its app lists Cardano connections as "Coming Soon", and its
 * extension refuses pages in mobile browsers before asking anyone (see OKX_FOCUS_BLOCK_MS).
 */
export function okxUnsupportedReason(): string | null {
  if (isOkxApp()) return "The OKX app doesn't connect to Cardano sites yet (OKX lists it as coming soon).";
  if (isMobileBrowser()) return "OKX Wallet connects to Cardano sites only from a desktop browser.";
  return null;
}

/** A wallet app that can open a page in its own browser, where the page sees the wallet (CIP-30). */
export interface WalletAppLink {
  id: string;
  name: string;
  href: string;
}

/**
 * Links that open `url` inside a Cardano wallet app's browser: how a phone signs in, since phone
 * browsers run no wallet extensions. Vespr and Eternl take the CIP-158 link (web+cardano://browse);
 * Yoroi and Begin publish their own https links, which also open their site when the app is missing.
 * They must be followed straight from a tap: iOS ignores app links opened after async work.
 */
export function walletAppLinks(url: string): WalletAppLink[] {
  const u = encodeURIComponent(url);
  return [
    // One standard link: the phone opens whichever of the two is installed, so they share a button.
    { id: "cip158", name: "Vespr or Eternl", href: `web+cardano://browse/v1?uri=${u}` },
    { id: "yoroi", name: "Yoroi", href: `https://yoroi-wallet.com/w1/browser/launch?dappUrl=${u}` },
    { id: "begin", name: "Begin", href: `https://begin-wallet.app.link/browse?dappUrl=${u}` },
  ];
}

function okxBlockedMessage(): string {
  const unsupported = okxUnsupportedReason();
  return unsupported
    ? `${unsupported} Open Locke in a Cardano wallet app (Vespr, Eternl, Yoroi or Begin), or use the OKX extension on a computer.`
    : "OKX Wallet blocked this before asking you: it only answers the page in the browser window it thinks is focused. Close other OKX windows, click anywhere on this page, then try again.";
}

async function connect(id: string): Promise<ConnectedWallet> {
  const ns = provider(id);
  if (!ns?.enable) throw new Error("Wallet not found. Install a Cardano wallet extension.");
  const started = Date.now();
  const api = await wallet("enable", ns.enable.bind(ns)).catch((e: WalletErr) => {
    // Still asked where OKX doesn't support Cardano yet (it may start to); any refusal there is that, not the person.
    if (id === "okxwallet" && (okxUnsupportedReason() || (e.code === 4001 && Date.now() - started < OKX_FOCUS_BLOCK_MS))) {
      throw new Error(`${okxBlockedMessage()}${said(e)}`);
    }
    if (!e.refused) throw e;
    throw new Error(`Your wallet refused the connection. ${STILL_OPEN}${said(e)}`);
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

function said(e: WalletErr): string {
  return e.walletText ? ` (Your wallet said: "${e.walletText.slice(0, 120)}")` : "";
}

/**
 * Whether two bech32 addresses belong to the same wallet account. Multi-address wallets (Eternl
 * multi-account, Yoroi) hand out a different change address later, so two base addresses match on
 * their stake credential (bytes 29..57); anything else must match exactly.
 */
export function sameAccount(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const x = bech32Decode(a);
    const y = bech32Decode(b);
    const base = (d: Uint8Array) => d.length === 57 && d[0] >> 4 <= 3;
    if (x.hrp !== y.hrp || !base(x.data) || !base(y.data)) return false;
    return x.data.subarray(29, 57).every((v, i) => v === y.data[29 + i]);
  } catch {
    return false;
  }
}

/** ADA in the wallet (whole ADA, floored). */
export async function walletAda(w: ConnectedWallet): Promise<number> {
  if (typeof w.api.getBalance !== "function") throw new Error("This wallet doesn't report its balance");
  const lovelace = decodeLovelace(await w.api.getBalance());
  return Number(lovelace / BigInt(1_000_000));
}

/** signData errors about the address form: DataSignError 2 (AddressNotPK) or APIError -1 (InvalidRequest). */
const addressRejected = (e: WalletErr) => e.code === 2 || e.code === -1;

/**
 * Sign plain text (Strike challenge) → "coseSign1Hex:coseKeyHex". CIP-30 says the address is hex,
 * but wallets differ: OKX signs for the address string exactly as it returned it. Locke tries the
 * wallet's own form first, then hex, then bech32 — moving on only when the wallet said the address
 * was the problem, so a person who declines is never asked twice.
 */
export async function signText(w: ConnectedWallet, text: string, alreadyHex = false): Promise<string> {
  const payload = alreadyHex ? text : utf8ToHex(text);
  const forms = [...new Set([w.addressRaw, w.addressHex, w.address].filter((a): a is string => !!a))];
  let last: WalletErr | null = null;
  for (const addr of forms) {
    try {
      const { signature, key } = await wallet("signData", () => w.api.signData(addr, payload));
      return `${signature}:${key}`;
    } catch (e) {
      last = e as WalletErr;
      if (!addressRejected(last)) break;
    }
  }
  if (last?.refused) throw new Error(`${CANCELLED} ${STILL_OPEN}${said(last)}`);
  throw last ?? new Error("Your wallet couldn't sign. Try again.");
}

/** Spendable UTxOs, possibly none: the server decides whether a deposit is needed at all. */
export async function walletUtxos(w: ConnectedWallet): Promise<string[]> {
  return (await w.api.getUtxos()) ?? [];
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
