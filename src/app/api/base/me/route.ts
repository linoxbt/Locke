import { NextResponse } from "next/server";
import { currentBaseSession } from "@/lib/server/baseSession";
import { HttpError } from "@/lib/server/errors";
import { route } from "@/lib/server/http";

export const GET = route(async () => {
  const s = await currentBaseSession();
  if (!s) throw new HttpError(401, "Not signed in");
  return NextResponse.json({ address: s.addr });
});
