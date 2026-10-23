import { NextResponse } from "next/server";
import { fuelContext } from "@/lib/server/fuelContext";
import { route } from "@/lib/server/http";

/** Live WTI and exchange rates (now and ~90 days ago) for the fuel form's defaults and warnings. */
export const GET = route(async () => NextResponse.json(await fuelContext()));
