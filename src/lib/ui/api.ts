"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
  }
}

/** The session ended or Strike dropped the connection: send the user to sign in again, then back here. */
function reconnect() {
  if (typeof window === "undefined" || window.location.pathname.startsWith("/connect")) return;
  const next = window.location.pathname + window.location.search;
  window.location.assign(`/connect?reconnect=1&next=${encodeURIComponent(next)}`);
}

export async function api<T = any>(path: string, init?: { method?: string; body?: unknown; quiet401?: boolean }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if ((res.status === 401 && !init?.quiet401) || data?.code === "reconnect") reconnect();
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data?.code);
  }
  return data as T;
}

/** A readable message for anything a flow can throw. Wallet errors are already translated in lib/cardano/wallet. */
export function errorMessage(e: unknown): string {
  if (!e) return "Something went wrong";
  if (typeof e === "string") return e;
  if (e instanceof ApiError) return e.message;
  const anyE = e as { info?: string; message?: string };
  return anyE.info || anyE.message || "Something went wrong";
}
