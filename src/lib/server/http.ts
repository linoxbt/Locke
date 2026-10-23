import { NextResponse } from "next/server";
import { PlanInputError } from "../domain/plans";
import { StrikeError } from "../strike/client";
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
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e instanceof ConfigError) {
        // The variable's name goes to the logs only; visitors get no hint about the setup.
        console.error("[config]", e.message);
        return NextResponse.json({ error: "Locke is temporarily unavailable. Try again shortly.", code: "unavailable" }, { status: 503 });
      }
      if (e instanceof PlanInputError) return NextResponse.json({ error: e.message }, { status: 400 });
      if (e instanceof StrikeError) {
        console.error("[strike]", e.status, e.message);
        if (e.status === 401 || e.status === 403) {
          return NextResponse.json(
            { error: "Strike no longer accepts Locke's connection to your account. Sign in again to reconnect.", code: "reconnect" },
            { status: 502 }
          );
        }
        const status = e.status >= 400 && e.status < 500 ? 400 : 502;
        return NextResponse.json({ error: `Strike: ${e.message}` }, { status });
      }
      console.error(e);
      return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
    }
  };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new HttpError(413, "Request too large");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "Request too large");
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

/** The caller's IP as the platform reports it (Netlify first, then the standard proxy header). */
export function clientIp(req: Request): string | null {
  const ip = req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0];
  return ip?.trim().slice(0, 64) || null;
}
