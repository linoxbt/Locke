import { NextResponse } from "next/server";
import { BasePlanError } from "../domain/basePlans";
import { PlanInputError } from "../domain/plans";
import { StrikeError } from "../strike/client";
import { VerantaError } from "../veranta/client";
import { ConfigError } from "./config";
import { HttpError } from "./errors";

/** Largest JSON body any route accepts (a deposit's UTxO list is the biggest legitimate one). */
const MAX_BODY_BYTES = 256 * 1024;

/** Wrap a route handler: typed errors become clean JSON, everything else a logged 500. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) {
        // Some errors carry a code the browser acts on (e.g. utxos_required), not just words.
        const code = (e as HttpError & { code?: unknown }).code;
        return NextResponse.json(typeof code === "string" ? { error: e.message, code } : { error: e.message }, { status: e.status });
      }
      if (e instanceof ConfigError) {
        // The variable's name goes to the logs only; visitors get no hint about the setup.
        console.error("[config]", e.message);
        return NextResponse.json({ error: "Locke is temporarily unavailable. Try again shortly.", code: "unavailable" }, { status: 503 });
      }
      if (e instanceof PlanInputError) return NextResponse.json({ error: e.message }, { status: 400 });
      if (e instanceof BasePlanError) return NextResponse.json({ error: e.message }, { status: 400 });
      if (e instanceof VerantaError) {
        // Avantis down or answering oddly: say so, and let the page retry.
        console.error("[avantis]", e.status, e.message);
        return NextResponse.json({ error: "Avantis isn't answering right now. Try again shortly.", code: "avantis_unavailable" }, { status: e.status === 404 ? 404 : 503 });
      }
      if (e instanceof StrikeError) {
        console.error("[strike]", e.status, e.message);
        if (e.status === 401 || e.status === 403) {
          return NextResponse.json(
            { error: "Strike no longer accepts Locke's connection to your account. Sign in again to reconnect.", code: "reconnect" },
            { status: 502 }
          );
        }
        const status = e.status >= 400 && e.status < 500 ? 400 : 502;
        return NextResponse.json({ error: strikeErrorText(e) }, { status });
      }
      console.error(e);
      return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
    }
  };
}

/**
 * What a user sees for a Strike failure. Strike's own error text is shown only when it is a short
 * sentence from its error body; anything else (our "POST /v2/x failed (400)" fallback, JSON,
 * stack-like text) becomes a fixed message. Network failures carry Locke's own wording (body null).
 */
export function strikeErrorText(e: StrikeError): string {
  const b = e.body as { error?: unknown; message?: unknown } | null;
  const fromBody = !!b && typeof b === "object" && (b.error === e.message || b.message === e.message);
  if (fromBody && e.message.length <= 160 && !/[{}[\]<>\n\r\t]|\bat\s+\S+\s*\(|\.(?:js|ts):\d/.test(e.message)) return `Strike: ${e.message}`;
  if (b === null && e.status >= 500) return e.message; // strikeFetch's own "didn't answer in time" / "unreachable"
  return e.status >= 400 && e.status < 500 ? "Strike refused the request." : "Strike is unavailable right now. Try again shortly.";
}

/** The body, read as a stream and abandoned once it passes MAX_BODY_BYTES (a chunked body has no length up front). */
async function readBody(req: Request): Promise<string> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new HttpError(413, "Request too large");
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, "Request too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await readBody(req);
  try {
    const body = JSON.parse(text);
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    /* fallthrough */
  }
  throw new HttpError(400, "Expected a JSON object");
}

/** A string field with a length cap; anything else is a 400. */
export function str(body: Record<string, unknown>, key: string, max: number, pattern?: RegExp): string {
  const v = body[key];
  if (typeof v !== "string" || !v || v.length > max || (pattern && !pattern.test(v))) throw new HttpError(400, `Invalid ${key}`);
  return v;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A plan or deposit id from the URL. Anything that isn't a UUID is a 404 and never reaches Postgres. */
export function idParam(id: string, notFound: string): string {
  if (!UUID.test(id)) throw new HttpError(404, notFound);
  return id;
}

/** The caller's IP as the platform reports it (Netlify first, then the standard proxy header). */
export function clientIp(req: Request): string | null {
  const ip = req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0];
  return ip?.trim().slice(0, 64) || null;
}
