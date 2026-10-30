// Minimal bech32 (not bech32m) for Cardano Shelley addresses.

const ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function convertBits(data: ArrayLike<number>, from: number, to: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (let i = 0; i < data.length; i++) {
    acc = (acc << from) | data[i];
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) out.push((acc << (to - bits)) & maxv);
  else if (!pad && (bits >= from || ((acc << (to - bits)) & maxv) !== 0)) throw new Error("Invalid padding");
  return out;
}

export function bech32Encode(hrp: string, data: Uint8Array): string {
  const words = convertBits(data, 8, 5, true);
  const values = hrpExpand(hrp).concat(words, [0, 0, 0, 0, 0, 0]);
  const mod = polymod(values) ^ 1;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) checksum.push((mod >> (5 * (5 - i))) & 31);
  return hrp + "1" + words.concat(checksum).map((w) => ALPHABET[w]).join("");
}

export function bech32Decode(str: string): { hrp: string; data: Uint8Array } {
  const lower = str.toLowerCase();
  const pos = lower.lastIndexOf("1");
  if (pos < 1 || pos + 7 > lower.length) throw new Error("Invalid bech32 string");
  const hrp = lower.slice(0, pos);
  const words: number[] = [];
  for (const ch of lower.slice(pos + 1)) {
    const v = ALPHABET.indexOf(ch);
    if (v === -1) throw new Error("Invalid bech32 character");
    words.push(v);
  }
  if (polymod(hrpExpand(hrp).concat(words)) !== 1) throw new Error("Invalid bech32 checksum");
  return { hrp, data: new Uint8Array(convertBits(words.slice(0, -6), 5, 8, false)) };
}

/** CIP-30 hex address → bech32. Header nibble 0xE/0xF = reward (stake) address. */
export function addressToBech32(bytes: Uint8Array, networkId: number): string {
  const header = bytes[0] >> 4;
  const isStake = header === 0b1110 || header === 0b1111;
  const base = isStake ? "stake" : "addr";
  return bech32Encode(networkId === 1 ? base : `${base}_test`, bytes);
}

export function isBech32Address(s: string): boolean {
  try {
    const { hrp } = bech32Decode(s);
    return hrp === "addr" || hrp === "addr_test";
  } catch {
    return false;
  }
}

export function isBech32Stake(s: string): boolean {
  try {
    const { hrp } = bech32Decode(s);
    return hrp === "stake" || hrp === "stake_test";
  } catch {
    return false;
  }
}

/** An address from a CIP-30 wallet as bytes. The standard says hex, but some wallets return bech32. */
export function walletAddressBytes(s: string): Uint8Array {
  const t = s.trim();
  if (/^[0-9a-f]+$/i.test(t) && t.length % 2 === 0) {
    const out = new Uint8Array(t.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(t.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  return bech32Decode(t).data;
}

/**
 * The reward (stake) address inside a base address, for wallets without getRewardAddresses.
 * Base addresses (header types 0–3) carry header + 28-byte payment + 28-byte stake credential;
 * the reward header is 0xE0 for a key stake credential (types 0, 1) and 0xF0 for a script (2, 3)
 * (CIP-19: types 2 and 3 carry a script stake credential).
 * Other address types carry no stake credential: null.
 */
export function stakeFromBaseAddress(bytes: Uint8Array): Uint8Array | null {
  const type = bytes[0] >> 4;
  if (type > 3 || bytes.length !== 57) return null;
  const network = bytes[0] & 0x0f;
  const out = new Uint8Array(29);
  out[0] = (type === 2 || type === 3 ? 0xf0 : 0xe0) | network;
  out.set(bytes.subarray(29, 57), 1);
  return out;
}
