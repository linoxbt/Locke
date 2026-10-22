"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/ui/api";
import { detectWallets, enableWallet, signText, type ConnectedWallet, type WalletOption } from "@/lib/cardano/wallet";

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
  /** Connect a wallet and sign in through Strike's builder connect. */
  signIn(walletId: string): Promise<void>;
  /** Re-enable the wallet the session belongs to (needed to sign deposits after a reload). */
  ensureWallet(): Promise<ConnectedWallet>;
  signOut(): Promise<void>;
}

const WalletContext = createContext<Ctx | null>(null);
const LAST_WALLET = "locke.wallet";

function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_WALLET, id);
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
      const { user } = await api<{ user: Me | null }>("/api/me");
      setMe(user);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshMe();
    // Wallet extensions inject window.cardano shortly after load.
    const scan = () => setWallets(detectWallets());
    scan();
    const t1 = setTimeout(scan, 400);
    const t2 = setTimeout(scan, 1500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [refreshMe]);

  const signIn = useCallback(
    async (walletId: string) => {
      const w = await enableWallet(walletId);
      const { nonce, message } = await api<{ nonce: string; message: string }>("/api/connect/start", {
        body: { address: w.address, stakeAddress: w.stakeAddress },
      });
      const signature = await signText(w, message);
      await api("/api/connect/finish", { body: { nonce, signature } });
      remember(walletId);
      setWallet(w);
      await refreshMe();
    },
    [refreshMe]
  );

  const ensureWallet = useCallback(async () => {
    if (wallet) return wallet;
    const id = recall() ?? detectWallets()[0]?.id;
    if (!id) throw new Error("Open your Cardano wallet extension and try again.");
    const w = await enableWallet(id);
    if (me && w.address !== me.address) {
      throw new Error("This wallet is not the one you signed in with. Switch accounts in your wallet, or sign in again.");
    }
    setWallet(w);
    return w;
  }, [wallet, me]);

  const signOut = useCallback(async () => {
    await api("/api/logout", { body: {} }).catch(() => {});
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
