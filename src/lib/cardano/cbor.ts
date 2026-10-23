// Just enough CBOR to work with CIP-30 data without a serialization library.
//
// The key constraint: a transaction id is the hash of the body's exact bytes, so
// adding the wallet's witnesses must never re-encode the body. We therefore
// scan item boundaries and copy raw byte ranges instead of decode → encode.

import { bytesToHex, concatBytes, hexToBytes } from "./bytes";

interface Head {
  major: number;
  /** Argument value (length / count / uint). null for indefinite length. */
  value: bigint | null;
  /** Bytes taken by the head itself. */
  headLen: number;
}

export function readHead(buf: Uint8Array, off: number): Head {
  if (off >= buf.length) throw new Error("CBOR: unexpected end");
  const ib = buf[off];
  const major = ib >> 5;
  const ai = ib & 0x1f;
  if (ai < 24) return { major, value: BigInt(ai), headLen: 1 };
  const sizes: Record<number, number> = { 24: 1, 25: 2, 26: 4, 27: 8 };
  if (ai in sizes) {
    const n = sizes[ai];
    if (off + 1 + n > buf.length) throw new Error("CBOR: unexpected end");
    let v = BigInt(0);
    for (let i = 0; i < n; i++) v = (v << BigInt(8)) | BigInt(buf[off + 1 + i]);
    return { major, value: v, headLen: 1 + n };
  }
  if (ai === 31) return { major, value: null, headLen: 1 };
  throw new Error("CBOR: reserved additional info");
}

/** Offset just past the item starting at `off`. */
export function skipItem(buf: Uint8Array, off: number): number {
  const h = readHead(buf, off);
  let p = off + h.headLen;
  switch (h.major) {
    case 0:
    case 1:
      return p;
    case 2:
    case 3:
      if (h.value === null) {
        while (buf[p] !== 0xff) p = skipItem(buf, p);
        return p + 1;
      }
      return p + Number(h.value);
    case 4:
    case 5: {
      const per = h.major === 5 ? 2 : 1;
      if (h.value === null) {
        while (buf[p] !== 0xff) p = skipItem(buf, p);
        return p + 1;
      }
      for (let i = 0; i < Number(h.value) * per; i++) p = skipItem(buf, p);
      return p;
    }
    case 6:
      return skipItem(buf, p);
    case 7:
      return p;
    default:
      throw new Error("CBOR: bad major type");
  }
}

function encodeHead(major: number, n: number): Uint8Array {
  const m = major << 5;
  if (n < 24) return Uint8Array.of(m | n);
  if (n < 0x100) return Uint8Array.of(m | 24, n);
  if (n < 0x10000) return Uint8Array.of(m | 25, n >> 8, n & 0xff);
  return Uint8Array.of(m | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
}

/** Raw elements of a definite or indefinite array (optionally wrapped in tag 258). */
function arrayElements(buf: Uint8Array, off: number): { items: Uint8Array[]; tagged: boolean } {
  let h = readHead(buf, off);
  let tagged = false;
  if (h.major === 6) {
    tagged = h.value === BigInt(258);
    off += h.headLen;
    h = readHead(buf, off);
  }
  if (h.major !== 4) throw new Error("CBOR: expected array");
  let p = off + h.headLen;
  const items: Uint8Array[] = [];
  if (h.value === null) {
    while (buf[p] !== 0xff) {
      const end = skipItem(buf, p);
      items.push(buf.slice(p, end));
      p = end;
    }
  } else {
    for (let i = 0; i < Number(h.value); i++) {
      const end = skipItem(buf, p);
      items.push(buf.slice(p, end));
      p = end;
    }
  }
  return { items, tagged };
}

/** Map entries as [key uint, raw value bytes]. Witness-set keys are small uints. */
function mapEntries(buf: Uint8Array, off: number): Map<number, Uint8Array> {
  const h = readHead(buf, off);
  if (h.major !== 5) throw new Error("CBOR: expected map");
  let p = off + h.headLen;
  const out = new Map<number, Uint8Array>();
  const readEntry = () => {
    const kh = readHead(buf, p);
    if (kh.major !== 0 || kh.value === null) throw new Error("CBOR: expected uint key");
    p += kh.headLen;
    const end = skipItem(buf, p);
    out.set(Number(kh.value), buf.slice(p, end));
    p = end;
  };
  if (h.value === null) {
    while (buf[p] !== 0xff) readEntry();
  } else {
    for (let i = 0; i < Number(h.value); i++) readEntry();
  }
  return out;
}

/**
 * Merge a CIP-30 signTx() witness set into an unsigned transaction.
 * Body, validity flag and auxiliary data are copied byte for byte.
 */
export function mergeWitnesses(txHex: string, walletWitnessHex: string): string {
  const tx = hexToBytes(txHex);
  const h = readHead(tx, 0);
  if (h.major !== 4 || h.value === null || Number(h.value) < 3) throw new Error("Not a transaction");
  const count = Number(h.value);
  const parts: Uint8Array[] = [];
  let p = h.headLen;
  for (let i = 0; i < count; i++) {
    const end = skipItem(tx, p);
    parts.push(tx.slice(p, end));
    p = end;
  }
  const txWs = mapEntries(parts[1], 0);
  const walletWs = mapEntries(hexToBytes(walletWitnessHex), 0);

  const merged = new Map(txWs);
  for (const [k, v] of walletWs) {
    const existing = merged.get(k);
    if (!existing) {
      merged.set(k, v);
      continue;
    }
    // Keys 0 (vkey), 2 (bootstrap) and the script/datum lists are arrays or sets: union them.
    const a = arrayElements(existing, 0);
    const b = arrayElements(v, 0);
    const seen = new Set(a.items.map(bytesToHex));
    const items = [...a.items, ...b.items.filter((x) => !seen.has(bytesToHex(x)))];
    const body = concatBytes(encodeHead(4, items.length), ...items);
    merged.set(k, a.tagged || b.tagged ? concatBytes(Uint8Array.of(0xd9, 0x01, 0x02), body) : body);
  }

  const keys = [...merged.keys()].sort((x, y) => x - y);
  const ws = concatBytes(
    encodeHead(5, keys.length),
    ...keys.flatMap((k) => [encodeHead(0, k), merged.get(k)!])
  );
  parts[1] = ws;
  return bytesToHex(concatBytes(encodeHead(4, count), ...parts));
}

/** CIP-30 getBalance(): Value = coin | [coin, multiasset]. Returns lovelace. */
export function decodeLovelace(valueHex: string): bigint {
  const buf = hexToBytes(valueHex);
  let h = readHead(buf, 0);
  if (h.major === 4) h = readHead(buf, h.headLen);
  if (h.major !== 0 || h.value === null) throw new Error("Unexpected balance encoding");
  return h.value;
}
