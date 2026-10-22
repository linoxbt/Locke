"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

export async function api<T = any>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

/** Wallet errors arrive in many shapes (CIP-30 APIError objects, strings). */
export function errorMessage(e: unknown): string {
  if (!e) return "Something went wrong";
  if (typeof e === "string") return e;
  const anyE = e as { info?: string; message?: string; code?: number };
  if (anyE.code === -3 || anyE.code === 2 || /declin|reject|cancel/i.test(anyE.info ?? anyE.message ?? "")) {
    return "Request cancelled in your wallet.";
  }
  return anyE.info ?? anyE.message ?? "Something went wrong";
}
