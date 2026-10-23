import { describe, expect, it, vi } from "vitest";
import { signText, walletError, type ConnectedWallet } from "@/lib/cardano/wallet";

const okxDenied = { code: 4001, message: "Request Signature: User denied request signature." };

function walletThatRefuses(afterMs: number): ConnectedWallet {
  const api = {
    signData: () => new Promise((_, reject) => setTimeout(() => reject(okxDenied), afterMs)),
  } as unknown as ConnectedWallet["api"];
  return { id: "okxwallet", api, address: "addr1x", addressHex: "01", stakeAddress: null };
}

describe("wallet errors", () => {
  it("reads OKX's denial as a cancellation, by code or by wording", () => {
    expect(walletError(okxDenied, "signData").message).toBe("Request cancelled in your wallet.");
    expect(walletError({ message: "User denied request signature." }, "signTx").message).toBe("Request cancelled in your wallet.");
  });

  it("says when the wallet refused before anyone could press Reject", async () => {
    vi.useFakeTimers();
    const fast = signText(walletThatRefuses(50), "hello");
    const fastResult = expect(fast).rejects.toThrow(/refused to sign without showing a signature window/);
    await vi.advanceTimersByTimeAsync(60);
    await fastResult;

    const slow = signText(walletThatRefuses(5000), "hello");
    const slowResult = expect(slow).rejects.toThrow("Request cancelled in your wallet.");
    await vi.advanceTimersByTimeAsync(5100);
    await slowResult;
    vi.useRealTimers();
  });
});
