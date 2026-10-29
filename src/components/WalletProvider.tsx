"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/ui/api";
import { detectWallets, enableWallet, sameAccount, signText, type ConnectedWallet, type WalletOption } from "@/lib/cardano/wallet";
import { allowPreferences } from "@/lib/consent";

export interface Me {
  address: string;
  stakeAddress: string | null;
  accountId: string | null;
  balance: { wallet: number; available: number } | null;
}

interface Ctx {
  me: Me | null;
  loading: boolean;
  wallet: ConnectedWallet | null;
  wallets: WalletOption[];
  refreshMe(): Promise<void>;
  /** Connect a wallet and sign in through Strike's builder connect. `onStep` reports progress for the UI. */
  signIn(walletId: string, onStep?: (step: SignInStep, message?: string) => void): Promise<void>;
  /**
   * Re-enable the wallet the session belongs to (needed to sign deposits after a reload). It asks
   * the wallet for access, so call it from a click. Keeps one identity across renders.
   */
  ensureWallet(): Promise<ConnectedWallet>;
  signOut(): Promise<void>;
}

/** approve: wallet asked for access · sign: Strike's message is with the wallet · finish: verifying with Strike. */
export type SignInStep = "approve" | "sign" | "finish";

const WalletContext = createContext<Ctx | null>(null);
/** How long to keep looking for injected wallets after load. */
export const SCAN_FOR_MS = 6000;
const LAST_WALLET = "locke.wallet";

/** Remembering the wallet across visits is a preference: only with the visitor's cookie consent. */
function remember(id: string | null) {
  try {
    if (id && allowPreferences()) localStorage.setItem(LAST_WALLET, id);
    else localStorage.removeItem(LAST_WALLET);
  } catch {
    /* storage unavailable: the user just picks the wallet again */
  }
}

function recall(): string | null {
  try {
    return localStorage.getItem(LAST_WALLET);
  } catch {
    return null;
  }
}

/** `initialAddress` comes from the server's session so the header renders signed-in state on first paint. */
export function WalletProvider({ children, initialAddress = null }: { children: React.ReactNode; initialAddress?: string | null }) {
  const [me, setMe] = useState<Me | null>(
    initialAddress ? { address: initialAddress, stakeAddress: null, accountId: null, balance: null } : null
  );
  const [loading, setLoading] = useState(true);
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [wallets, setWallets] = useState<WalletOption[]>([]);

  const refreshMe = useCallback(async () => {
    try {
      const { user } = await api<{ user: Me | null }>("/api/me", { quiet401: true });
      setMe(user);
    } catch (e) {
      // Only the server saying "signed out" clears the user; a network blip keeps what we had.
      if (e instanceof ApiError && e.status === 401) setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshMe();
    // Extensions inject window.cardano shortly after load; wallet apps' in-app browsers on phones can
    // take seconds. Keep looking for a while, and whenever the page regains focus (back from a wallet app).
    const scan = () =>
      setWallets((prev) => {
        const found = detectWallets();
        return found.length === prev.length && found.every((w, i) => w.id === prev[i].id) ? prev : found;
      });
    scan();
    const started = Date.now();
    const poll = setInterval(() => (Date.now() - started > SCAN_FOR_MS ? clearInterval(poll) : scan()), 300);
    const onVisible = () => document.visibilityState === "visible" && scan();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", scan);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", scan);
    };
  }, [refreshMe]);

  const signIn = useCallback(
    async (walletId: string, onStep?: (step: SignInStep, message?: string) => void) => {
      onStep?.("approve");
      const w = await enableWallet(walletId);
      const { nonce, message } = await api<{ nonce: string; message: string }>("/api/connect/start", {
        body: { address: w.address, stakeAddress: w.stakeAddress },
      });
      onStep?.("sign", message);
      const signature = await signText(w, message);
      onStep?.("finish");
      await api("/api/connect/finish", { body: { nonce, signature } });
      remember(walletId);
      setWallet(w);
      await refreshMe();
    },
    [refreshMe]
  );

  // Read through a ref so ensureWallet never changes identity: effects that depend on it must not
  // re-run (and ask the wallet again) when /api/me resolves.
  const current = useRef({ wallet, me });
  current.current = { wallet, me };

  const ensureWallet = useCallback(async () => {
    if (current.current.wallet) return current.current.wallet;
    const id = recall() ?? detectWallets()[0]?.id;
    if (!id) throw new Error("Open your Cardano wallet extension and try again.");
    const w = await enableWallet(id);
    const signedIn = current.current.me;
    // Multi-address wallets hand out a new change address later: same stake key, same account.
    if (signedIn && !sameAccount(w.address, signedIn.address)) {
      throw new Error("This wallet is not the one you signed in with. Switch accounts in your wallet, or sign in again.");
    }
    setWallet(w);
    return w;
  }, []);

  /** Throws if the server couldn't end the session, so the UI never claims a sign-out that didn't happen. */
  const signOut = useCallback(async () => {
    await api("/api/logout", { body: {}, quiet401: true });
    remember(null);
    setWallet(null);
    setMe(null);
  }, []);

  const value = useMemo(
    () => ({ me, loading, wallet, wallets, refreshMe, signIn, ensureWallet, signOut }),
    [me, loading, wallet, wallets, refreshMe, signIn, ensureWallet, signOut]
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): Ctx {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet outside WalletProvider");
  return ctx;
}
