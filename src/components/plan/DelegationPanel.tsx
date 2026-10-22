"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/ui/api";
import { num, shortAddr } from "@/lib/ui/format";
import { Card, Eyebrow, Spinner } from "../ui";

interface Delegation {
  pool: string | null;
  poolTicker: string | null;
  drep: string | null;
}

/** Evidence that hedged ADA keeps working: still staked, still voting (Koios). */
export function DelegationPanel({ q, hideCovered = false }: { q: number; hideCovered?: boolean }) {
  const [data, setData] = useState<Delegation | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api<{ delegation: Delegation | null }>("/api/delegation")
      .then((r) => setData(r.delegation))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  return (
    <Card tone="mist">
      <Eyebrow className="text-ink-2">Your ADA, still working</Eyebrow>
      {!loaded ? (
        <Spinner className="mt-6" />
      ) : (
        <dl className="mt-6 space-y-4">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[14px] text-ink-2">Staked to</dt>
            <dd className="num text-[20px]">{data?.poolTicker ?? (data?.pool ? shortAddr(data.pool) : "—")}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[14px] text-ink-2">Voting through</dt>
            <dd className="num truncate text-[15px]">{data?.drep ? shortAddr(data.drep) : "no DRep"}</dd>
          </div>
          <div className={`flex items-baseline justify-between gap-4 ${hideCovered ? "hidden" : ""}`}>
            <dt className="text-[14px] text-ink-2">Covered by this plan</dt>
            <dd className="num text-[15px]">{num(q, 0)} ADA</dd>
          </div>
        </dl>
      )}
      <p className="mt-6 text-[13px] text-ink-3">Hedged ADA never moves. Only margin deposits leave your wallet.</p>
    </Card>
  );
}
