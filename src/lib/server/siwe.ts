import { randomBytes } from "node:crypto";
import { getAddress, isAddressEqual, recoverMessageAddress, type Address, type Hex } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { BASE_CHAIN_ID } from "../base/contracts";
import { basePublicClient } from "./baseChain";
import { db } from "./db";
import { HttpError } from "./errors";

/** How long a sign-in nonce, and a signed message, stay good. */
const MAX_AGE_MS = 10 * 60_000;
/** Allowed clock skew for a wallet's issuedAt in the future. */
const SKEW_MS = 60_000;
const PER_NETWORK = 30;
/** A ceiling on all sign-ins, high enough that one attacker's handful of networks can't lock everyone out. */
const GLOBAL_PER_MINUTE = 3000;

/** A single-use nonce for one sign-in, counted against the caller's network. */
export async function issueNonce(network: string | null): Promise<string> {
  const sql = db();
  const nonce = randomBytes(16).toString("hex");
  await sql`delete from base_auth_nonces where created_at < now() - interval '10 minutes'`;
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('locke:base-nonce'))`;
    const [c] = await tx`
      select count(*) filter (where created_at > now() - interval '1 minute')::int as global,
             count(*) filter (where ${network}::text is not null and network = ${network})::int as by_network
      from base_auth_nonces`;
    if (c.global >= GLOBAL_PER_MINUTE || c.by_network >= PER_NETWORK) throw new HttpError(429, "Too many sign-in attempts. Wait a few minutes and try again.");
    await tx`insert into base_auth_nonces (nonce, network) values (${nonce}, ${network})`;
  });
  return nonce;
}

export interface SignInFields {
  address: Address;
  nonce: string;
}

const HEADER = /^(?:[a-zA-Z][a-zA-Z0-9+\-.]*:\/\/)?(?<domain>[a-zA-Z0-9+\-.]*(?::[0-9]{1,5})?) wants you to sign in with your Ethereum account:\n(?<address>0x[a-fA-F0-9]{40})\n/;

/**
 * viem's parser, plus the header read on its own: viem's only allows a one-line statement, and a
 * wallet may write a longer one (Base Account writes its own). Line endings are normalised first.
 * Reading is lenient only here; the signature is still checked over the exact message signed.
 */
export function readSiweMessage(message: string): ReturnType<typeof parseSiweMessage> {
  const text = message.replace(/\r\n?/g, "\n");
  const m = parseSiweMessage(text);
  if (m.domain && m.address) return m;
  const head = text.match(HEADER)?.groups;
  return head ? { ...m, domain: head.domain, address: head.address as Address } : m;
}

/**
 * Everything about a Sign-In with Ethereum message except the signature and the nonce's
 * freshness: it is for this site (domain and URI), for Base, and inside its time window.
 */
export function checkSiweMessage(message: string, expected: { host: string; now?: number }): SignInFields {
  if (typeof message !== "string" || message.length > 4096) throw new HttpError(400, "Invalid sign-in message");
  const m = readSiweMessage(message);
  const now = expected.now ?? Date.now();
  if (!m.address || !m.nonce || !m.domain || !m.uri || m.version !== "1") {
    // Logged so a wallet whose message we can't read can be diagnosed; it holds no secret.
    console.warn("[siwe] unreadable sign-in message", JSON.stringify(message));
    throw new HttpError(400, "Invalid sign-in message");
  }
  if (m.domain !== expected.host) throw new HttpError(400, "This sign-in was made for another site");
  let uriHost: string;
  try {
    uriHost = new URL(m.uri).host;
  } catch {
    throw new HttpError(400, "Invalid sign-in message");
  }
  if (uriHost !== expected.host) throw new HttpError(400, "This sign-in was made for another site");
  if (m.chainId !== BASE_CHAIN_ID) throw new HttpError(400, "Sign in on Base");
  if (!m.issuedAt || m.issuedAt.getTime() > now + SKEW_MS || now - m.issuedAt.getTime() > MAX_AGE_MS) throw new HttpError(400, "This sign-in expired. Try again.");
  if (m.expirationTime && m.expirationTime.getTime() <= now) throw new HttpError(400, "This sign-in expired. Try again.");
  if (m.notBefore && m.notBefore.getTime() > now + SKEW_MS) throw new HttpError(400, "This sign-in isn't valid yet");
  if (!/^[A-Za-z0-9]{8,64}$/.test(m.nonce)) throw new HttpError(400, "Invalid sign-in message");
  return { address: getAddress(m.address), nonce: m.nonce };
}

/**
 * The signature is the address's: an ordinary wallet's is recovered locally; a smart wallet
 * (Base Account) is checked on Base with ERC-1271, or ERC-6492 before it is deployed.
 */
export async function signatureMatches(address: Address, message: string, signature: Hex): Promise<boolean> {
  if (signature.length === 132) {
    try {
      if (isAddressEqual(await recoverMessageAddress({ message, signature }), address)) return true;
    } catch {
      /* not a plain ECDSA signature: fall through to the on-chain check */
    }
  }
  try {
    return await basePublicClient().verifyMessage({ address, message, signature });
  } catch {
    return false;
  }
}

/** Spend the nonce (single use, unexpired). False when it was never issued, already used or too old. */
export async function consumeNonce(nonce: string): Promise<boolean> {
  const [row] = await db()`
    delete from base_auth_nonces where nonce = ${nonce} and created_at > now() - interval '10 minutes' returning nonce`;
  return !!row;
}

/** Check a Sign in with Base request end to end; returns the signer's address (lower-case). */
export async function verifySignIn(input: { message: string; signature: string }, host: string): Promise<string> {
  if (typeof input.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(input.signature) || input.signature.length > 20_000) {
    throw new HttpError(400, "Invalid signature");
  }
  const fields = checkSiweMessage(input.message, { host });
  if (!(await consumeNonce(fields.nonce))) throw new HttpError(400, "This sign-in expired. Try again.");
  if (!(await signatureMatches(fields.address, input.message, input.signature as Hex))) {
    throw new HttpError(401, "That signature isn't from this account. Try signing in again.");
  }
  return fields.address.toLowerCase();
}
