export function usd(n: number | null | undefined, digits = 2): string {
  if (n == null || !isFinite(n)) return "—";
  const sign = n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function signedUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || !isFinite(n)) return "—";
  return `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function num(n: number | null | undefined, digits = 2): string {
  if (n == null || !isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function price(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return n < 10 ? n.toFixed(5) : n.toFixed(2);
}

export function pct(n: number | null | undefined, digits = 0): string {
  if (n == null || !isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function local(n: number | null | undefined, currency: string, digits = 0): string {
  if (n == null || !isFinite(n)) return "—";
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** A local price: whole units from 100 up, cents below (GHS 18.46, NGN 1,250). */
export function localPrice(n: number | null | undefined, currency: string): string {
  return local(n, currency, n != null && Math.abs(n) < 100 ? 2 : 0);
}

/** Compact local amount for tight table cells: NGN 1.88M, NGN 950K. */
export function localCompact(n: number | null | undefined, currency: string): string {
  if (n == null || !isFinite(n)) return "—";
  return `${currency} ${n.toLocaleString("en-US", { notation: Math.abs(n) >= 100_000 ? "compact" : "standard", maximumFractionDigits: Math.abs(n) >= 100_000 ? 2 : 0 })}`;
}

export function shortAddr(a: string): string {
  return a.length > 20 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a;
}

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Explorer link for a transaction on the network Locke runs on. */
export const CARDANOSCAN = `https://${process.env.NEXT_PUBLIC_CARDANO_NETWORK_ID === "0" ? "preprod." : ""}cardanoscan.io/transaction/`;
