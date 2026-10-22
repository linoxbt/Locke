import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { getMarkPrice } from "@/lib/strike/client";

export const GET = route(async () => {
  const [ada, wti] = await Promise.all([getMarkPrice("ADA-USD"), getMarkPrice("WTI-USD")]);
  return NextResponse.json({ ada, wti });
});
