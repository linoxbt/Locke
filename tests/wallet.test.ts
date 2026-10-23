import { afterEach, describe, expect, it, vi } from "vitest";
import { enableWallet, signText, walletError, type ConnectedWallet } from "@/lib/cardano/wallet";

const okxDenied = { code: 4001, message: "Request Signature: User denied request signature." };
const BECH32 = "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x";

function walletThatRefuses(afterMs: number): ConnectedWallet {
  const api = {
    signData: () => new Promise((_, reject) => setTimeout(() => reject(okxDenied), afterMs)),
  } as unknown as ConnectedWallet["api"];
  return { id: "okxwallet", api, address: "addr1x", addressHex: "01", stakeAddress: null };
}

/** Behaves like OKX's documented Cardano provider: bech32 addresses, a string network id, signs only for its own address string. */
function okxLike({ refuseFirstEnable = false } = {}) {
  let enables = 0;
  const signedWith: string[] = [];
  const api = {
    getNetworkId: async () => "1",
    getUtxos: async () => [],
    getChangeAddress: async () => BECH32,
    getUsedAddresses: async () => [BECH32],
    signData: async (addr: string) => {
      signedWith.push(addr);
      if (addr !== BECH32) throw okxDenied; // instant: no window shown
      return { signature: "aa", key: "bb" };
    },
    signTx: async () => "",
    submitTx: async () => "",
  };
  (globalThis as { window?: unknown }).window = {
    cardano: {
      okxwallet: {
        name: "OKX Wallet",
        enable: async () => {
          enables += 1;
          if (refuseFirstEnable && enables === 1) throw okxDenied;
          return api;
        },
      },
    },
  };
  return { signedWith, enables: () => enables };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.useRealTimers();
});

describe("wallet errors", () => {
  it("reads OKX's denial as a cancellation, by code or by wording, and keeps the wallet's words", () => {
    const e = walletError(okxDenied, "signData") as Error & { walletText?: string };
    expect(e.message).toBe("Request cancelled in your wallet.");
    expect(e.walletText).toBe(okxDenied.message);
    expect(walletError(new Error("User denied request signature."), "signTx").message).toBe("Request cancelled in your wallet.");
  });

  it("says when the wallet refused before anyone could press Reject, and never re-asks a person who declined", async () => {
    vi.useFakeTimers();
    const fast = signText(walletThatRefuses(50), "hello");
    const fastResult = expect(fast).rejects.toThrow(/refused to sign without showing a signature window/);
    await vi.advanceTimersByTimeAsync(200);
    await fastResult;

    const calls = vi.fn();
    const w = walletThatRefuses(5000);
    const sign = w.api.signData.bind(w.api);
    w.api.signData = (a: string, p: string) => (calls(), sign(a, p));
    const slow = signText(w, "hello");
    const slowResult = expect(slow).rejects.toThrow("Request cancelled in your wallet.");
    await vi.advanceTimersByTimeAsync(5100);
    await slowResult;
    expect(calls).toHaveBeenCalledTimes(1);
  });
});

describe("OKX-style wallets", () => {
  it("connects with a string network id and signs with the address exactly as the wallet gave it", async () => {
    const okx = okxLike();
    const w = await enableWallet("okxwallet");
    expect(w.address).toBe(BECH32);
    expect(w.addressRaw).toBe(BECH32);
    expect(w.stakeAddress).toMatch(/^stake1/);
    expect(await signText(w, "Connect to Strike")).toBe("aa:bb");
    expect(okx.signedWith).toEqual([BECH32]);
  });

  it("falls back to another address form when the wallet rejects one instantly", async () => {
    const okx = okxLike();
    const w = await enableWallet("okxwallet");
    // As if the raw form were hex: the wallet refuses it instantly, then signs for bech32.
    expect(await signText({ ...w, addressRaw: w.addressHex }, "Connect to Strike")).toBe("aa:bb");
    expect(okx.signedWith).toEqual([w.addressHex, BECH32]);
  });

  it("asks the wallet once more when it refuses the connection instantly", async () => {
    const okx = okxLike({ refuseFirstEnable: true });
    const w = await enableWallet("okxwallet");
    expect(w.address).toBe(BECH32);
    expect(okx.enables()).toBe(2);
  });
});
