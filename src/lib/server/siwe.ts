import { randomBytes } from "node:crypto";
import { getAddress, isAddressEqual, recoverMessageAddress, type Address, type Hex } from "viem";
import { BASE_CHAIN_ID } from "../base/contracts";
import { basePublicClient } from "./baseChain";
import { db } from "./db";
import { HttpError } from "./errors";

/** How long a sign-in nonce, and a signed message, stay good. */
const MAX_AGE_MS = 10 * 60_000;
/** Allowed clock skew for a wallet's issuedAt in the future. */
const SKEW_MS = 60_000;
/**
 * Sign-ins started per caller network (IPv4 /24, IPv6 /48) in the nonces' 10 minutes. There is no
 * ceiling on all sign-ins together: one attacker with enough networks could fill it and lock
 * everyone out. A network past its limit only locks out itself.
 */
const PER_NETWORK = 30;

/** A single-use nonce for one sign-in, counted against the caller's network. */
export async function issueNonce(network: string | null): Promise<string> {
  const sql = db();
  const nonce = randomBytes(16).toString("hex");
  await sql`delete from base_auth_nonces where created_at < now() - interval '10 minutes'`;
  await sql.begin(async (tx) => {
    if (network) {
      // One count-and-insert at a time per network, so a burst can't all pass the count together.
      await tx`select pg_advisory_xact_lock(hashtext(${`locke:base-nonce:${network}`}))`;
      const [c] = await tx`select count(*)::int as n from base_auth_nonces where network = ${network} and created_at > now() - interval '10 minutes'`;
      if (c.n >= PER_NETWORK) throw new HttpError(429, "Too many sign-in attempts. Wait a few minutes and try again.");
    }
    await tx`insert into base_auth_nonces (nonce, network) values (${nonce}, ${network})`;
  });
  return nonce;
}

export interface SignInFields {
  address: Address;
  nonce: string;
  /** Version or Issued At is missing: only smart wallets (Base Account) write such messages. */
  partial: boolean;
}

const HEADER = /^(?:[a-zA-Z][a-zA-Z0-9+\-.]*:\/\/)?(?<domain>[a-zA-Z0-9+\-.]*(?::[0-9]{1,5})?) wants you to sign in with your Ethereum account:\n(?<address>0x[a-fA-F0-9]{40})\n/;
const FIELDS = { URI: "uri", Version: "version", "Chain ID": "chainId", Nonce: "nonce", "Issued At": "issuedAt", "Expiration Time": "expirationTime", "Not Before": "notBefore" } as const;
type Field = (typeof FIELDS)[keyof typeof FIELDS];
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export interface SiweFields {
  domain?: string;
  address?: Address;
  fields: Partial<Record<Field, string>>;
}

/**
 * The header (site and account) and the "Key: value" lines of a Sign-In with Ethereum message.
 * Read line by line rather than with EIP-4361's fixed layout, because wallets differ: Coinbase
 * Wallet (Base Account) leaves out Version and Issued At, and some write a multi-line statement.
 * A key given twice makes the message unreadable. The signature is checked over the exact message.
 */
export function readSiweMessage(message: string): SiweFields {
  const text = message.replace(/\r\n?/g, "\n");
  const head = text.match(HEADER)?.groups;
  const fields: SiweFields["fields"] = {};
  for (const line of text.slice(head ? text.match(HEADER)![0].length : 0).split("\n")) {
    const kv = line.match(/^([A-Za-z ]+): (.+)$/);
    const key = kv && FIELDS[kv[1] as keyof typeof FIELDS];
    if (!key) continue;
    if (fields[key] !== undefined) return { fields: {} };
    fields[key] = kv[2].trim();
  }
  return { domain: head?.domain, address: head?.address as Address | undefined, fields };
}

/**
 * An EIP-4361 date-time; undefined when absent, NaN when present but unreadable. Wallets that
 * write another ISO-8601 shape (no seconds fraction rules, a space for the T) are still read.
 */
function time(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (DATE_TIME.test(v)) return new Date(v).getTime();
  const t = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v) ? Date.parse(v.replace(" ", "T")) : Number.NaN;
  return Number.isFinite(t) ? t : Number.NaN;
}

/** Why a sign-in message was refused, logged (never the message, which names the account). */
function refuse(reason: string, status = 400, text = "Invalid sign-in message"): never {
  console.warn(`[siwe] refused: ${reason}`);
  throw new HttpError(status, text);
}

/**
 * Everything about a Sign-In with Ethereum message except the signature and the nonce's
 * freshness: it is for this site (domain and URI), for Base, and inside its time window. Without
 * an Issued At, freshness rests on the nonce alone, which Locke issued and expires in 10 minutes.
 */
export function checkSiweMessage(message: string, expected: { host: string; now?: number }): SignInFields {
  if (typeof message !== "string" || message.length > 4096) throw new HttpError(400, "Invalid sign-in message");
  const { domain, address, fields: f } = readSiweMessage(message);
  const now = expected.now ?? Date.now();
  if (!address || !domain || !f.nonce || !f.uri || !f.chainId || (f.version !== undefined && !/^1(\.0)?$/.test(f.version))) {
    // Which parts were missing, so a wallet whose message can't be read can be diagnosed; not the
    // message itself, which names the account.
    const present = [domain && "domain", address && "address", ...Object.keys(f)].filter(Boolean).join(",");
    console.warn(`[siwe] unreadable sign-in message (${message.length} chars; has ${present || "nothing"})`);
    throw new HttpError(400, "Invalid sign-in message");
  }
  if (domain !== expected.host) refuse(`domain ${domain.length} chars, not this site`, 400, "This sign-in was made for another site");
  // The URI is this site; some wallets write it without the scheme.
  let uriHost: string | null = null;
  try {
    uriHost = new URL(/^[a-z][a-z0-9+\-.]*:\/\//i.test(f.uri) ? f.uri : `https://${f.uri}`).host;
  } catch {
    refuse("uri unreadable");
  }
  if (uriHost !== expected.host) refuse("uri for another site", 400, "This sign-in was made for another site");
  const chain = f.chainId.replace(/^eip155:/i, "");
  if (!/^\d+$/.test(chain) || Number(chain) !== BASE_CHAIN_ID) refuse(`chain ${f.chainId.slice(0, 20)}`, 400, "Sign in on Base");
  const [issuedAt, expiresAt, notBefore] = [time(f.issuedAt), time(f.expirationTime), time(f.notBefore)];
  if ([issuedAt, expiresAt, notBefore].some((t) => Number.isNaN(t))) refuse("a date is unreadable");
  if (issuedAt !== undefined && (issuedAt > now + SKEW_MS || now - issuedAt > MAX_AGE_MS))
    refuse("issued-at outside the window", 400, "This sign-in expired. Try again.");
  if (expiresAt !== undefined && expiresAt <= now) refuse("expired", 400, "This sign-in expired. Try again.");
  if (notBefore !== undefined && notBefore > now + SKEW_MS) refuse("not-before in the future", 400, "This sign-in isn't valid yet");
  // Locke issues the nonce and spends it once; this only keeps junk out of the lookup.
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(f.nonce)) refuse("nonce shape");
  return { address: getAddress(address), nonce: f.nonce, partial: f.version === undefined || f.issuedAt === undefined };
}

/**
 * The signature is the address's: an ordinary wallet's is recovered locally; a smart wallet
 * (Base Account) is checked on Base with ERC-1271, or ERC-6492 before it is deployed.
 */
export async function signatureMatches(address: Address, message: string, signature: Hex): Promise<"wallet" | "smart" | false> {
  if (signature.length === 132) {
    try {
      if (isAddressEqual(await recoverMessageAddress({ message, signature }), address)) return "wallet";
    } catch {
      /* not a plain ECDSA signature: fall through to the on-chain check */
    }
  }
  try {
    return (await basePublicClient().verifyMessage({ address, message, signature })) ? "smart" : false;
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
  if (!(await consumeNonce(fields.nonce))) refuse("nonce unknown, used or old", 400, "This sign-in expired. Try again.");
  const signer = await signatureMatches(fields.address, input.message, input.signature as Hex);
  if (!signer) {
    console.warn(`[siwe] refused: signature does not match (${input.signature.length} chars)`);
    throw new HttpError(401, "That signature isn't from this account. Try signing in again.");
  }
  // A message without Version or Issued At (Base Account writes those) is as safe as a full one:
  // its nonce is Locke's, single use, and at most 10 minutes old. Whatever signed it, it counts.
  return fields.address.toLowerCase();
}
