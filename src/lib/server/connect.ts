import { createPublicKey, verify } from "node:crypto";
import { blake2b } from "@noble/hashes/blake2.js";
import { bech32Decode } from "../cardano/bech32";
import { bytesToHex, hexToBytes } from "../cardano/bytes";
import { coseKeyEd25519, decodeCoseSign1, sigStructure } from "../cardano/cose";
import { StrikeError } from "../strike/client";
import { HttpError } from "./errors";

/**
 * Strike's connect calls. The Strike client rewrites the "own builder code" refusal into advice
 * (a 409 whose text isn't Strike's); keep that text for the user instead of the generic refusal.
 */
export async function strikeConnect<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (e) {
    if (e instanceof StrikeError && e.status === 409 && /Locke's builder code/.test(e.message)) throw new HttpError(409, e.message);
    throw e;
  }
}

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");

export const blake2b224 = (b: Uint8Array) => blake2b(b, { dkLen: 28 });

const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The payment key hash of a Shelley address whose payment part is a key (types 0, 2, 4, 6:
 * base, pointer, enterprise). Script-locked and Byron addresses have no key to check: null.
 */
export function paymentKeyHash(addr: Uint8Array): Uint8Array | null {
  const type = addr[0] >> 4;
  if (addr.length < 29 || type > 7 || type % 2 !== 0) return null;
  return addr.subarray(1, 29);
}

/**
 * Local check of a CIP-30 signData() result ("coseSign1Hex:coseKeyHex") before Strike is asked:
 * the key hashes to the address's payment credential, the signed header names that address, the
 * payload is exactly the challenge (or its blake2b-224 when the wallet hashed it), and the
 * Ed25519 signature over the Sig_structure holds. Returns why it failed, or null.
 */
export function walletSignatureProblem(p: { signature: string; address: string; message: string }): string | null {
  try {
    const [sigHex, keyHex] = p.signature.split(":");
    const cose = decodeCoseSign1(hexToBytes(sigHex));
    const pub = coseKeyEd25519(hexToBytes(keyHex));
    const addr = bech32Decode(p.address).data;

    const alg = cose.protectedHeaders.get(1);
    if (alg !== undefined && alg !== -8) return "algorithm is not EdDSA";
    // CIP-8 puts the raw address bytes here; tolerate a wallet that wrote the bech32 or hex text instead.
    const named = cose.protectedHeaders.get("address");
    if (!(named instanceof Uint8Array)) return "no address in the signed header";
    const text = new TextDecoder().decode(named);
    if (!equal(named, addr) && text !== p.address && text.toLowerCase() !== bytesToHex(addr)) return "signed header names another address";

    const pkh = paymentKeyHash(addr);
    if (!pkh) return "address has no payment key";
    if (!equal(blake2b224(pub), pkh)) return "key does not match the address";

    const message = new TextEncoder().encode(p.message);
    const hashed = cose.unprotected.get("hashed") === true;
    if (!cose.payload || !equal(cose.payload, hashed ? blake2b224(message) : message)) return "payload is not the challenge";

    if (cose.signature.length !== 64) return "bad signature length";
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519, pub]), format: "der", type: "spki" });
    if (!verify(null, sigStructure(cose.protectedRaw, cose.payload), key, cose.signature)) return "signature does not verify";
    return null;
  } catch (e) {
    return `unreadable signature (${(e as Error).message})`;
  }
}

/**
 * Strike's api_wallet_expired_at: an ISO date-time per its OpenAPI ("9999-12-31T23:59:59Z"),
 * though epoch seconds or milliseconds are accepted too. Year 9999 and later means it never expires.
 */
export function parseStrikeExpiry(v: unknown): Date | null {
  if (v == null || v === "") return null;
  let d: Date;
  if (typeof v === "number" || (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()))) {
    const n = Number(v);
    d = new Date(n > 1e12 ? n : n * 1000);
  } else if (typeof v === "string") {
    d = new Date(v);
  } else {
    return null;
  }
  if (isNaN(d.getTime()) || d.getUTCFullYear() >= 9999) return null;
  return d;
}
