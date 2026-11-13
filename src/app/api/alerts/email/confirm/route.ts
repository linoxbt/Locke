import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { confirmEmail } from "@/lib/server/userAlerts";

/** The link in the confirmation email; back to the account page either way. */
export const GET = route(async (req: Request) => {
  const url = new URL(req.url);
  const ok = await confirmEmail(url.searchParams.get("t") ?? "");
  return NextResponse.redirect(new URL(`/account?email=${ok ? "confirmed" : "expired"}`, url.origin), 303);
});
