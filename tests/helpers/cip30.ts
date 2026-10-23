import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { bech32Encode } from "@/lib/cardano/bech32";
import { bytesToHex } from "@/lib/cardano/bytes";
import { cborEncode, sigStructure, type CborKey, type CborValue } from "@/lib/cardano/cose";
import { blake2b224 } from "@/lib/server/connect";

// ── A CIP-30 wallet, as far as signData goes ──

export function walletKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { pub: new Uint8Array(Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url")), privateKey };
}

/** Mainnet address bytes: base (type 0) with a stake credential, or enterprise (type 6). */
export function addressBytes(pub: Uint8Array, opts: { header?: number; stake?: Uint8Array } = {}) {
  const header = opts.header ?? 0x01;
  const enterprise = header >> 4 === 6;
  const out = new Uint8Array(enterprise ? 29 : 57);
  out[0] = header;
  out.set(blake2b224(pub), 1);
  if (!enterprise) out.set(opts.stake ?? new Uint8Array(28).fill(7), 29);
  return out;
}

export const bech = (bytes: Uint8Array) => bech32Encode("addr", bytes);

/** signData(addr, utf8 message) → "coseSign1Hex:coseKeyHex", the way wallets build it (CIP-8). */
export function signData(
  signer: { pub: Uint8Array; privateKey: KeyObject },
  headerAddress: Uint8Array,
  message: string,
  opts: { hashed?: boolean; keyPub?: Uint8Array; tag18?: boolean } = {}
) {
  const prot = cborEncode(new Map<CborKey, CborValue>([[1, -8], ["address", headerAddress]]));
  const msg = new TextEncoder().encode(message);
  const payload = opts.hashed ? blake2b224(msg) : msg;
  const sig = new Uint8Array(sign(null, sigStructure(prot, payload), signer.privateKey));
  let cose = cborEncode([prot, new Map<CborKey, CborValue>([["hashed", !!opts.hashed]]), payload, sig]);
  if (opts.tag18) cose = Uint8Array.from([0xd2, ...cose]);
  const key = cborEncode(new Map<CborKey, CborValue>([[1, 1], [3, -8], [-1, 6], [-2, opts.keyPub ?? signer.pub]]));
  return `${bytesToHex(cose)}:${bytesToHex(key)}`;
}
