import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex, hexToBytes } from "./bytes";
import { readHead, skipItem } from "./cbor";

/**
 * A Cardano transaction's id: blake2b-256 of its body, the first element of the transaction array,
 * hashed exactly as the bytes appear (witnesses don't change it).
 */
export function txBodyHash(txHex: string): string {
  const tx = hexToBytes(txHex);
  const h = readHead(tx, 0);
  if (h.major !== 4) throw new Error("Not a transaction");
  const end = skipItem(tx, h.headLen);
  return bytesToHex(blake2b(tx.subarray(h.headLen, end), { dkLen: 32 }));
}
