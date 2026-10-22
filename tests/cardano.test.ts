import { describe, expect, it } from "vitest";
import { bech32Decode, bech32Encode, addressToBech32, isBech32Stake } from "@/lib/cardano/bech32";
import { bytesToHex, hexToBytes } from "@/lib/cardano/bytes";
import { decodeLovelace, mergeWitnesses, skipItem } from "@/lib/cardano/cbor";

const vkey = "58" + "20" + "11".repeat(32);
const sig = "58" + "40" + "22".repeat(64);
const witness = "82" + vkey + sig; // [vkey, sig]

// body: {0: [], 1: [], 2: 170000}
const body = "a3" + "0080" + "0180" + "02" + "1a" + "00029810";

describe("mergeWitnesses", () => {
  it("adds wallet vkey witnesses and keeps the body bytes", () => {
    const tx = "84" + body + "a0" + "f5" + "f6";
    const walletWs = "a1" + "00" + "81" + witness;
    const out = mergeWitnesses(tx, walletWs);
    expect(out).toBe("84" + body + "a1" + "00" + "81" + witness + "f5" + "f6");
    const bytes = hexToBytes(out);
    expect(skipItem(bytes, 0)).toBe(bytes.length);
  });

  it("unions with existing witnesses and keeps the Conway set tag", () => {
    const other = "82" + "58" + "20" + "33".repeat(32) + sig;
    const tx = "84" + body + "a1" + "00" + "d90102" + "81" + other + "f5" + "f6";
    const out = mergeWitnesses(tx, "a1" + "00" + "d90102" + "81" + witness);
    expect(out).toContain(body);
    expect(out).toContain("a1" + "00" + "d90102" + "82" + other + witness);
  });

  it("keeps other witness-set entries (scripts, redeemers)", () => {
    const tx = "84" + body + "a1" + "05" + "80" + "f5" + "f6";
    const out = mergeWitnesses(tx, "a1" + "00" + "81" + witness);
    expect(out).toBe("84" + body + "a2" + "00" + "81" + witness + "05" + "80" + "f5" + "f6");
  });
});

describe("decodeLovelace", () => {
  it("reads plain coin and [coin, multiasset]", () => {
    expect(decodeLovelace("1a000f4240")).toBe(BigInt(1_000_000));
    expect(decodeLovelace("82" + "1b00000002540be400" + "a0")).toBe(BigInt(10_000_000_000));
  });
});

describe("bech32", () => {
  it("round-trips a real stake address", () => {
    const addr = "stake1uy89kzrdlpaz5rzu8x95r4qnlpqhd3f8mf09edjp73vcs3qhktrtm";
    const { hrp, data } = bech32Decode(addr);
    expect(bech32Encode(hrp, data)).toBe(addr);
    expect(addressToBech32(data, 1)).toBe(addr);
    expect(isBech32Stake(addr)).toBe(true);
    expect(() => bech32Decode(addr.slice(0, -1) + "q")).toThrow();
  });

  it("encodes payment addresses by network", () => {
    const bytes = hexToBytes("01" + "ab".repeat(56));
    expect(addressToBech32(bytes, 1).startsWith("addr1")).toBe(true);
    expect(addressToBech32(bytes, 0).startsWith("addr_test1")).toBe(true);
    expect(bytesToHex(bech32Decode(addressToBech32(bytes, 1)).data)).toBe("01" + "ab".repeat(56));
  });
});
