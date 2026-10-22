import { NextResponse } from "next/server";
import { PlanInputError } from "../domain/plans";
import { StrikeError } from "../strike/client";
import { HttpError } from "./errors";

/** Wrap a route handler: typed errors become clean JSON, everything else a logged 500. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e instanceof PlanInputError) return NextResponse.json({ error: e.message }, { status: 400 });
      if (e instanceof StrikeError) {
        console.error("[strike]", e.status, e.message);
        const status = e.status >= 400 && e.status < 500 ? 400 : 502;
        return NextResponse.json({ error: `Strike: ${e.message}` }, { status });
      }
      console.error(e);
      return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
    }
  };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    /* fallthrough */
  }
  throw new HttpError(400, "Expected a JSON object");
}
