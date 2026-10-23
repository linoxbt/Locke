// Just enough CBOR and COSE to check a CIP-30 signData() result (CIP-8 COSE_Sign1 + COSE_Key).
// Decoding is strict: definite or indefinite lengths, no trailing bytes, bounded nesting.

export type CborValue = number | bigint | string | Uint8Array | boolean | null | undefined | CborValue[] | Map<CborKey, CborValue>;
export type CborKey = number | string;

const MAX_DEPTH = 16;

class Reader {
  off = 0;
  constructor(readonly buf: Uint8Array) {}

  byte(): number {
    if (this.off >= this.buf.length) throw new Error("CBOR: unexpected end");
    return this.buf[this.off++];
  }

  take(n: number): Uint8Array {
    if (n > this.buf.length - this.off) throw new Error("CBOR: unexpected end");
    const out = this.buf.slice(this.off, this.off + n);
    this.off += n;
    return out;
  }

  /** Major type and argument; argument null = indefinite length. */
  head(): { major: number; arg: bigint | null; ai: number } {
    const ib = this.byte();
    const major = ib >> 5;
    const ai = ib & 0x1f;
    if (ai < 24) return { major, arg: BigInt(ai), ai };
    if (ai <= 27) {
      let v = BigInt(0);
      for (const b of this.take(1 << (ai - 24))) v = (v << BigInt(8)) | BigInt(b);
      return { major, arg: v, ai };
    }
    if (ai === 31 && major >= 2 && major <= 5) return { major, arg: null, ai };
    throw new Error("CBOR: unsupported additional info");
  }

  len(arg: bigint): number {
    if (arg > BigInt(this.buf.length - this.off)) throw new Error("CBOR: length past end");
    return Number(arg);
  }

  item(depth = 0): CborValue {
    if (depth > MAX_DEPTH) throw new Error("CBOR: too deep");
    const { major, arg, ai } = this.head();
    switch (major) {
      case 0:
        return arg! <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(arg) : arg!;
      case 1: {
        const v = BigInt(-1) - arg!;
        return v >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(v) : v;
      }
      case 2:
      case 3: {
        let bytes: Uint8Array;
        if (arg === null) {
          // Indefinite: definite chunks of the same major type until 0xff.
          const chunks: Uint8Array[] = [];
          while (this.buf[this.off] !== 0xff) {
            const h = this.head();
            if (h.major !== major || h.arg === null) throw new Error("CBOR: bad string chunk");
            chunks.push(this.take(this.len(h.arg)));
          }
          this.off++;
          bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
          let o = 0;
          for (const c of chunks) {
            bytes.set(c, o);
            o += c.length;
          }
        } else {
          bytes = this.take(this.len(arg));
        }
        return major === 2 ? bytes : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      }
      case 4: {
        const out: CborValue[] = [];
        if (arg === null) {
          while (this.buf[this.off] !== 0xff) out.push(this.item(depth + 1));
          this.off++;
        } else {
          for (let i = 0, n = this.len(arg); i < n; i++) out.push(this.item(depth + 1));
        }
        return out;
      }
      case 5: {
        const out = new Map<CborKey, CborValue>();
        const entry = () => {
          const k = this.item(depth + 1);
          if (typeof k !== "number" && typeof k !== "string") throw new Error("CBOR: unsupported map key");
          if (out.has(k)) throw new Error("CBOR: duplicate map key");
          out.set(k, this.item(depth + 1));
        };
        if (arg === null) {
          while (this.buf[this.off] !== 0xff) entry();
          this.off++;
        } else {
          for (let i = 0, n = this.len(arg); i < n; i++) entry();
        }
        return out;
      }
      case 6:
        return this.item(depth + 1); // tags carry no meaning we rely on (COSE_Sign1 may be tag 18)
      case 7:
        if (ai === 20) return false;
        if (ai === 21) return true;
        if (ai === 22) return null;
        if (ai === 23) return undefined;
        throw new Error("CBOR: unsupported simple value");
      default:
        throw new Error("CBOR: bad major type");
    }
  }
}

export function cborDecode(buf: Uint8Array): CborValue {
  const r = new Reader(buf);
  const v = r.item();
  if (r.off !== buf.length) throw new Error("CBOR: trailing bytes");
  return v;
}

function head(major: number, n: number): Uint8Array {
  const m = major << 5;
  if (n < 24) return Uint8Array.of(m | n);
  if (n < 0x100) return Uint8Array.of(m | 24, n);
  if (n < 0x10000) return Uint8Array.of(m | 25, n >> 8, n & 0xff);
  if (n <= 0xffffffff) return Uint8Array.of(m | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
  throw new Error("CBOR: value too large");
}

/** Canonical-enough encoder for the small values COSE needs (ints, strings, bytes, arrays, maps in insertion order). */
export function cborEncode(v: CborValue): Uint8Array {
  const parts: Uint8Array[] = [];
  const put = (x: CborValue) => {
    if (typeof x === "number") {
      if (!Number.isSafeInteger(x)) throw new Error("CBOR: only integers are supported");
      parts.push(x >= 0 ? head(0, x) : head(1, -1 - x));
    } else if (typeof x === "string") {
      const b = new TextEncoder().encode(x);
      parts.push(head(3, b.length), b);
    } else if (x instanceof Uint8Array) {
      parts.push(head(2, x.length), x);
    } else if (Array.isArray(x)) {
      parts.push(head(4, x.length));
      x.forEach(put);
    } else if (x instanceof Map) {
      parts.push(head(5, x.size));
      for (const [k, val] of x) {
        put(k);
        put(val);
      }
    } else if (x === false || x === true) {
      parts.push(Uint8Array.of(x ? 0xf5 : 0xf4));
    } else if (x === null) {
      parts.push(Uint8Array.of(0xf6));
    } else {
      throw new Error("CBOR: unsupported value");
    }
  };
  put(v);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export interface CoseSign1 {
  /** The protected header exactly as signed (the bstr's contents). */
  protectedRaw: Uint8Array;
  protectedHeaders: Map<CborKey, CborValue>;
  unprotected: Map<CborKey, CborValue>;
  /** null when the payload is detached. */
  payload: Uint8Array | null;
  signature: Uint8Array;
}

/** COSE_Sign1 = [protected: bstr .cbor header_map, unprotected: header_map, payload: bstr / nil, signature: bstr]. */
export function decodeCoseSign1(buf: Uint8Array): CoseSign1 {
  const v = cborDecode(buf);
  if (!Array.isArray(v) || v.length !== 4) throw new Error("COSE_Sign1: expected a 4-element array");
  const [prot, unprot, payload, signature] = v;
  if (!(prot instanceof Uint8Array) || !(unprot instanceof Map) || !(signature instanceof Uint8Array)) {
    throw new Error("COSE_Sign1: malformed");
  }
  if (payload !== null && !(payload instanceof Uint8Array)) throw new Error("COSE_Sign1: malformed payload");
  // An empty protected bstr means an empty header map (RFC 9052 §3).
  const headers = prot.length === 0 ? new Map<CborKey, CborValue>() : cborDecode(prot);
  if (!(headers instanceof Map)) throw new Error("COSE_Sign1: protected header is not a map");
  return { protectedRaw: prot, protectedHeaders: headers, unprotected: unprot, payload, signature };
}

/** The 32-byte Ed25519 public key in a COSE_Key (OKP, crv Ed25519). */
export function coseKeyEd25519(buf: Uint8Array): Uint8Array {
  const key = cborDecode(buf);
  if (!(key instanceof Map)) throw new Error("COSE_Key: expected a map");
  const kty = key.get(1);
  const alg = key.get(3);
  const crv = key.get(-1);
  const x = key.get(-2);
  // kty OKP (1); alg EdDSA (-8) and crv Ed25519 (6) when present.
  if (kty !== 1 || (alg !== undefined && alg !== -8) || (crv !== undefined && crv !== 6)) throw new Error("COSE_Key: not an Ed25519 key");
  if (!(x instanceof Uint8Array) || x.length !== 32) throw new Error("COSE_Key: bad public key");
  return x;
}

/** Sig_structure for COSE_Sign1 with empty external_aad: the bytes the wallet actually signed. */
export function sigStructure(protectedRaw: Uint8Array, payload: Uint8Array): Uint8Array {
  return cborEncode(["Signature1", protectedRaw, new Uint8Array(0), payload]);
}
