import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ConnectExperience } from "@/components/ConnectExperience";
import { config } from "@/lib/server/config";
import { optionalSession, safeNext } from "@/lib/server/pageAuth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in — Locke" };

/** Full-bleed sign-in. Builder name and fee come from config so the message preview matches what Strike sends. */
export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ next?: string; reconnect?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  // reconnect=1: the session ended or Strike dropped the API wallet. Signing in again is the fix,
  // so a still-valid Locke cookie must not bounce the user straight back.
  const reconnect = sp.reconnect === "1";
  if (!reconnect && (await optionalSession())) redirect(next);

  let builder: string | null = null;
  let feeBps: number | null = null;
  try {
    builder = config.builderCode;
    feeBps = config.builderFeeBps;
  } catch {
    // Unconfigured deployment: the preview falls back to generic wording.
  }
  return <ConnectExperience next={next} builder={builder} feeBps={feeBps} reconnect={reconnect} />;
}
