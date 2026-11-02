import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ConnectExperience } from "@/components/ConnectExperience";
import { optionalBaseSession } from "@/lib/server/basePages";
import { safeNext } from "@/lib/server/pageAuth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in — Locke" };

/** Full-bleed sign-in with Base. Already signed in: straight on to where the visitor was heading. */
export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ next?: string; reconnect?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const reconnect = sp.reconnect === "1";
  if (!reconnect && (await optionalBaseSession())) redirect(next);
  return <ConnectExperience next={next} reconnect={reconnect} />;
}
