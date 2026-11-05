import { NextResponse } from "next/server";
import { currentBaseSession } from "@/lib/server/baseSession";
import { HttpError } from "@/lib/server/errors";
import { route } from "@/lib/server/http";
import { alertSettings } from "@/lib/server/userAlerts";

/** Where this account gets alerts about its plans. */
export const GET = route(async () => {
  const s = await currentBaseSession();
  if (!s) throw new HttpError(401, "Not signed in");
  return NextResponse.json(await alertSettings(s.uid));
});
