import { afterEach, describe, expect, it, vi } from "vitest";
import { bech32Decode, bech32Encode } from "@/lib/cardano/bech32";
import { enableWallet, sameAccount, signText, walletError, type ConnectedWallet } from "@/lib/cardano/wallet";

const okxDenied = { code: 4001, message: "Request Signature: User denied request signature." };
const addressNotPk = { code: 2, info: "Address is not a key hash for this wallet" };
const BECH32 = "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x";

/** Behaves like OKX's documented Cardano provider: bech32 addresses, a string network id, signs only for its own address string. */
function okxLike({ refuseEnable = false, wrongForm = addressNotPk as unknown, slowEnable = 0 } = {}) {
  let enables = 0;
  const signedWith: string[] = [];
  const api = {
    getNetworkId: async () => "1",
    getUtxos: async () => [],
    getChangeAddress: async () => BECH32,
    getUsedAddresses: async () => [BECH32],
    signData: async (addr: string) => {
      signedWith.push(addr);
      if (addr !== BECH32) throw wrongForm;
      return { signature: "aa", key: "bb" };
    },
    signTx: async () => "",
    submitTx: async () => "",
  };
  const enable = async () => {
    enables += 1;
    if (slowEnable) await new Promise((r) => setTimeout(r, slowEnable));
    if (refuseEnable) throw okxDenied;
    return api;
  };
  (globalThis as { window?: unknown }).window = { cardano: { okxwallet: { name: "OKX Wallet", enable } } };
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

  it("reports a node rejecting a submitted transaction as a failed submission, not a cancellation", () => {
    const e = walletError({ code: 2, info: "transaction rejected: BadInputsUTxO" }, "submitTx");
    expect(e.message).toMatch(/couldn't submit the transaction: transaction rejected: BadInputsUTxO/);
    expect(walletError(new Error("Transaction rejected by node"), "submitTx").message).toMatch(/couldn't submit/);
  });

  it("never re-asks a person who declined to sign", async () => {
    const calls = vi.fn();
    const api = {
      signData: async () => {
        calls();
        throw okxDenied;
      },
    } as unknown as ConnectedWallet["api"];
    const w: ConnectedWallet = { id: "okxwallet", api, address: BECH32, addressHex: "01", addressRaw: "02", stakeAddress: null };
    await expect(signText(w, "hello")).rejects.toThrow(/Request cancelled in your wallet\..*earlier wallet request may still be open.*User denied/);
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

  it("tries another address form only when the wallet says the address is the problem", async () => {
    const okx = okxLike();
    const w = await enableWallet("okxwallet");
    // As if the raw form were hex: the wallet answers AddressNotPK (code 2), then signs for bech32.
    expect(await signText({ ...w, addressRaw: w.addressHex }, "Connect to Strike")).toBe("aa:bb");
    expect(okx.signedWith).toEqual([w.addressHex, BECH32]);

    const invalid = okxLike({ wrongForm: { code: -1, info: "InvalidRequest" } });
    expect(await signText({ ...(await enableWallet("okxwallet")), addressRaw: w.addressHex }, "x")).toBe("aa:bb");
    expect(invalid.signedWith).toEqual([w.addressHex, BECH32]);

    const denied = okxLike({ wrongForm: okxDenied });
    await expect(signText({ ...(await enableWallet("okxwallet")), addressRaw: w.addressHex }, "x")).rejects.toThrow(/Request cancelled/);
    expect(denied.signedWith).toEqual([w.addressHex]);
  });

  it("shares one enable() between concurrent callers", async () => {
    vi.useFakeTimers();
    const okx = okxLike({ slowEnable: 500 });
    const a = enableWallet("okxwallet");
    const b = enableWallet("okxwallet");
    expect(a).toBe(b);
    await vi.advanceTimersByTimeAsync(600);
    const [wa, wb] = await Promise.all([a, b]);
    expect(wa).toBe(wb);
    expect(okx.enables()).toBe(1);
    // Settled requests are forgotten: the next call asks the wallet again.
    const again = enableWallet("okxwallet");
    expect(again).not.toBe(a);
    await vi.advanceTimersByTimeAsync(600);
    await again;
    expect(okx.enables()).toBe(2);
  });

  it("recognises OKX's own focus block (an instant 4001, no window shown) and says what to do", async () => {
    // Reproduced with the real OKX extension: with this tab outside the window OKX thinks is focused,
    // enable() is rejected in ~4 ms with this exact error and no OKX window opens.
    const okx = okxLike({ refuseEnable: true });
    await expect(enableWallet("okxwallet")).rejects.toThrow(/OKX Wallet blocked this before asking you.*Close other OKX windows/);
    expect(okx.enables()).toBe(1);

    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Linux; Android 14) Mobile Safari/537.36" });
    okxLike({ refuseEnable: true });
    await expect(enableWallet("okxwallet")).rejects.toThrow(/mobile browsers with extensions never pass that check.*Vespr or Eternl/);
    vi.unstubAllGlobals();
  });

  it("treats a slower refusal as the person declining in OKX's window, and doesn't ask again", async () => {
    const okx = okxLike({ refuseEnable: true, slowEnable: 600 });
    await expect(enableWallet("okxwallet")).rejects.toThrow(/refused the connection.*earlier wallet request may still be open.*User denied request signature/);
    expect(okx.enables()).toBe(1);
  });

  it("prefers window.okxwallet.cardano over window.cardano.okxwallet", async () => {
    okxLike();
    const stale = vi.fn(async () => {
      throw okxDenied;
    });
    const win = (globalThis as unknown as { window: { cardano: Record<string, { enable: unknown }>; okxwallet?: unknown } }).window;
    const real = win.cardano.okxwallet;
    win.cardano.okxwallet = { enable: stale };
    win.okxwallet = { cardano: real };
    const w = await enableWallet("okxwallet");
    expect(w.address).toBe(BECH32);
    expect(stale).not.toHaveBeenCalled();
  });
});

describe("same account", () => {
  const { hrp, data } = bech32Decode(BECH32);
  const withPayment = (byte: number) => {
    const d = data.slice();
    d[1] = byte; // payment credential differs, stake credential stays
    return bech32Encode(hrp, d);
  };
  const withStake = (byte: number) => {
    const d = data.slice();
    d[40] = byte;
    return bech32Encode(hrp, d);
  };

  it("matches base addresses that share a stake credential", () => {
    expect(sameAccount(BECH32, BECH32)).toBe(true);
    expect(sameAccount(BECH32, withPayment(data[1] ^ 0xff))).toBe(true);
    expect(sameAccount(BECH32, withStake(data[40] ^ 0xff))).toBe(false);
  });

  it("falls back to exact equality for anything else", () => {
    const enterprise = bech32Encode(hrp, Uint8Array.from([0x61, ...data.subarray(1, 29)]));
    expect(sameAccount(enterprise, enterprise)).toBe(true);
    expect(sameAccount(enterprise, BECH32)).toBe(false);
    expect(sameAccount("not an address", BECH32)).toBe(false);
  });
});
