"use client";

// Browser side of Locke on Base: Sign in with Base (Base Account, or any EVM wallet in the
// browser), and sending vault transactions from the business's own wallet.

import {
  createWalletClient,
  custom,
  getAddress,
  publicActions,
  toHex,
  type Address,
  type EIP1193Provider,
  type Hex,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { base } from "viem/chains";
import { createSiweMessage } from "viem/siwe";
import { BASE_CHAIN_ID } from "./contracts";

export type WalletKind = "base" | "injected";

const BASE_HEX = toHex(BASE_CHAIN_ID); // 0x2105
const KIND_KEY = "locke.base.wallet";

let baseProvider: EIP1193Provider | null = null;

/** Base Account's provider (passkey smart wallet; popup at keys.coinbase.com). Loaded on demand. */
async function baseAccountProvider(): Promise<EIP1193Provider> {
  if (!baseProvider) {
    // The browser build: the default export resolves to a Node build that bundles Coinbase's server SDK.
    const { createBaseAccountSDK } = await import("@base-org/account/browser");
    const sdk = createBaseAccountSDK({ appName: "Locke", appLogoUrl: `${window.location.origin}/apple-icon.png`, appChainIds: [BASE_CHAIN_ID] });
    baseProvider = sdk.getProvider() as unknown as EIP1193Provider;
  }
  return baseProvider;
}

function injectedProvider(): EIP1193Provider {
  const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  if (!eth) throw new Error("No wallet found in this browser. Use Sign in with Base, or install a wallet such as Coinbase Wallet or MetaMask.");
  return eth;
}

export function hasInjectedWallet(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum;
}

export async function providerFor(kind: WalletKind): Promise<EIP1193Provider> {
  return kind === "base" ? baseAccountProvider() : injectedProvider();
}

function rememberKind(kind: WalletKind) {
  try {
    localStorage.setItem(KIND_KEY, kind);
  } catch {
    /* private mode: the next action asks again */
  }
}

export function rememberedKind(): WalletKind {
  try {
    return localStorage.getItem(KIND_KEY) === "injected" ? "injected" : "base";
  } catch {
    return "base";
  }
}

/** A readable message for what wallets throw (rejections, unsupported methods, wrong network). */
export function walletErrorMessage(e: unknown): string {
  const err = e as { code?: number; shortMessage?: string; message?: string; details?: string };
  const text = `${err?.shortMessage ?? ""} ${err?.message ?? ""} ${err?.details ?? ""}`;
  if (err?.code === 4001 || /reject|denied|cancel/i.test(text)) return "You cancelled in your wallet.";
  if (/insufficient funds|exceeds balance/i.test(text)) return "Your wallet doesn't hold enough USDC or ETH for this.";
  return err?.shortMessage || err?.message || "The wallet couldn't complete this.";
}

/** The wallet doesn't offer a method (EIP-1193 4200, JSON-RPC -32601 / -32004), however it was wrapped. */
const unsupported = (e: unknown): boolean => {
  const err = e as { code?: number; message?: string; details?: string; cause?: unknown };
  if (!err) return false;
  if (err.code === 4200 || err.code === -32601 || err.code === -32004) return true;
  if (/method[_ ]not[_ ](supported|found)|not supported|does not exist|unsupported/i.test(`${err.message ?? ""} ${err.details ?? ""}`)) return true;
  return err.cause !== undefined && err.cause !== e && unsupported(err.cause);
};

async function switchToBase(provider: EIP1193Provider) {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_HEX }] });
  } catch (e) {
    if ((e as { code?: number }).code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: BASE_HEX, chainName: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] }],
      });
    } else if (!unsupported(e)) {
      throw e;
    }
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

/**
 * Sign in with Base. Base Account answers wallet_connect with a signed Sign-In with Ethereum
 * message in one step; other wallets connect, then sign the same message with personal_sign.
 */
export async function signInWithBase(kind: WalletKind): Promise<string> {
  const provider = await providerFor(kind);
  const { nonce } = await postJson<{ nonce: string }>("/api/base/auth/nonce", {});
  await switchToBase(provider);

  let address: Address | null = null;
  let message: string | null = null;
  let signature: Hex | null = null;
  try {
    const res = (await provider.request({
      method: "wallet_connect" as never,
      params: [{ version: "1", capabilities: { signInWithEthereum: { nonce, chainId: BASE_HEX } } }] as never,
    })) as { accounts: { address: Address; capabilities?: { signInWithEthereum?: { message: string; signature: Hex } } }[] };
    const acct = res.accounts?.[0];
    if (acct?.capabilities?.signInWithEthereum) {
      address = acct.address;
      message = acct.capabilities.signInWithEthereum.message;
      signature = acct.capabilities.signInWithEthereum.signature;
    }
  } catch (e) {
    if (!unsupported(e)) throw e;
  }

  if (!message || !signature || !address) {
    const [first] = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
    if (!first) throw new Error("The wallet didn't share an account.");
    address = getAddress(first);
    message = createSiweMessage({
      domain: window.location.host,
      address,
      statement: "Sign in to Locke on Base.",
      uri: window.location.origin,
      version: "1",
      chainId: BASE_CHAIN_ID,
      nonce,
      issuedAt: new Date(),
    });
    signature = (await provider.request({ method: "personal_sign", params: [toHex(message), address] })) as Hex;
  }

  const out = await postJson<{ address: string }>("/api/base/auth/verify", { message, signature });
  rememberKind(kind);
  return out.address;
}

export async function signOutOfBase() {
  await postJson("/api/base/auth/logout", {});
}

/**
 * A wallet client for the signed-in account, on Base, with Locke's Builder Code appended to each
 * transaction. Refuses when the wallet is on a different account than the session.
 */
export async function walletFor(sessionAddress: string, dataSuffix?: Hex): Promise<WalletClient & { account: { address: Address } }> {
  const provider = await providerFor(rememberedKind());
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
  const account = accounts.find((a) => a.toLowerCase() === sessionAddress.toLowerCase());
  if (!account) throw new Error(`Your wallet is on another account. Switch to ${sessionAddress.slice(0, 6)}…${sessionAddress.slice(-4)} and try again.`);
  await switchToBase(provider);
  return createWalletClient({ account: getAddress(account), chain: base, transport: custom(provider), dataSuffix }) as WalletClient & {
    account: { address: Address };
  };
}

export interface Call {
  to: Address;
  data: Hex;
  value?: bigint;
}

/**
 * Send calls as one batch (EIP-5792 wallet_sendCalls: one approval in Base Account, atomic where
 * the wallet supports it). Wallets without batching get one transaction per call instead, each
 * confirmed before the next, since an approval must land before the call that spends it.
 * Resolves with the receipts once they are on chain; throws if any call failed.
 */
export async function sendBaseCalls(wallet: WalletClient & { account: { address: Address } }, calls: Call[]): Promise<TransactionReceipt[]> {
  let id: string | null = null;
  try {
    ({ id } = await wallet.sendCalls({ account: wallet.account, chain: base, calls }));
  } catch (e) {
    if (!unsupported(e)) throw e;
  }
  const failed = () => new Error("The transaction didn't go through. Nothing was moved; check your wallet and try again.");
  if (id) {
    const status = await wallet.waitForCallsStatus({ id, timeout: 180_000 });
    if (status.status !== "success") throw failed();
    return (status.receipts ?? []) as unknown as TransactionReceipt[];
  }
  const reader = wallet.extend(publicActions);
  const receipts: TransactionReceipt[] = [];
  for (const c of calls) {
    const hash = await wallet.sendTransaction({ account: wallet.account, chain: base, to: c.to, data: c.data, value: c.value });
    const receipt = await reader.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw failed();
    receipts.push(receipt);
  }
  return receipts;
}
