"use client";

import { useEffect, useState } from "react";
import { ago } from "@/lib/ui/format";

const UTC_FMT: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" };

/** True after hydration. The server and the first client render agree; anything clock- or zone-dependent waits for this. */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** "5m ago", refreshed each minute. Renders the UTC timestamp until mounted so server and client HTML match. */
export function Ago({ iso }: { iso: string }) {
  const mounted = useMounted();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {mounted ? ago(iso) : new Date(iso).toLocaleString("en-GB", UTC_FMT) + " UTC"}
    </time>
  );
}

/** A date and time in the viewer's zone once mounted; UTC (labelled) on the server. */
export function When({ iso, dateOnly = false }: { iso: string; dateOnly?: boolean }) {
  const mounted = useMounted();
  const opts: Intl.DateTimeFormatOptions = dateOnly ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" };
  return (
    <time dateTime={iso}>
      {mounted ? new Date(iso).toLocaleString("en-GB", opts) : new Date(iso).toLocaleString("en-GB", { ...opts, timeZone: "UTC" }) + (dateOnly ? "" : " UTC")}
    </time>
  );
}
