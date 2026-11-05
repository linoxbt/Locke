export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * An error as it may be logged: viem's short message rather than the whole error, which quotes
 * the request (the RPC URL can carry its key), first line only, any URL left out.
 */
export function shortError(e: unknown): string {
  const err = e as { shortMessage?: unknown; message?: unknown } | null;
  const text = typeof err?.shortMessage === "string" ? err.shortMessage : typeof err?.message === "string" ? err.message : String(e);
  return text.split("\n")[0].replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]").slice(0, 300);
}
