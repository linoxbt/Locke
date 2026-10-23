"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/ui/api";
import { num, shortAddr } from "@/lib/ui/format";
import { Card, Eyebrow, REVEAL, Spinner } from "../ui";

interface Delegation {
  stakeAddress: string;
  pool: string | null;
  poolTicker: string | null;
  drep: string | null;
  /** Lovelace on the stake key (Koios total_balance), as a string or number. */
  totalLovelace: string | number | null;
}

/** Evidence that hedged ADA keeps working: still staked, still voting (Koios). */
export function DelegationPanel({ q, hideCovered = false }: { q: number; hideCovered?: boolean }) {
  const [data, setData] = useState<Delegation | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<{ delegation: Delegation | null }>("/api/delegation")
      .then((r) => setData(r.delegation))
      .catch(() => setFailed(true))
      .finally(() => setLoaded(true));
  }, []);
  const ada = data?.totalLovelace != null && data.totalLovelace !== "" ? Number(data.totalLovelace) / 1_000_000 : null;
  return (
    <Card tone="mist">
      <Eyebrow className="text-ink-2">Your ADA, still working</Eyebrow>
      {!loaded ? (
        <Spinner className="mt-6" />
      ) : failed ? (
        <p className="mt-6 text-[14px] text-ink-2">Couldn&apos;t read your stake delegation from Cardano right now.</p>
      ) : !data ? (
        // The sign-in address carries no stake key (an enterprise address), so there's nothing to look up.
        <p className="mt-6 text-[14px] text-ink-2">
          Delegation unknown: the address you signed in with has no stake key, so Locke can&apos;t see where its ADA is staked.
        </p>
      ) : (
        <dl className="mt-6 space-y-4">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[13px] text-ink-2">ADA in wallet</dt>
            <dd className="num text-[17px]">{ada != null && Number.isFinite(ada) ? `${num(ada, 0)} ADA` : "—"}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[13px] text-ink-2">Staked to</dt>
            <dd className="num text-[14px]">{data.poolTicker ?? (data.pool ? shortAddr(data.pool) : "Not delegated")}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[13px] text-ink-2">Voting through</dt>
            <dd className={`num text-[14px] ${REVEAL}`}>{data.drep ? shortAddr(data.drep) : "No DRep chosen"}</dd>
          </div>
          <div className={`flex items-baseline justify-between gap-4 ${hideCovered ? "hidden" : ""}`}>
            <dt className="text-[13px] text-ink-2">Hedged by this plan</dt>
            <dd className="num text-[14px]">{num(q, 0)} ADA</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[13px] text-ink-2">
              Stake address
              <span className="block text-[12px]">derived from your sign-in address</span>
            </dt>
            <dd className={`num text-[13px] ${REVEAL}`} title={data.stakeAddress}>
              {shortAddr(data.stakeAddress)}
            </dd>
          </div>
        </dl>
      )}
      <p className="mt-6 text-[13px] text-ink-3">Hedged ADA never moves. Only margin deposits leave your wallet.</p>
    </Card>
  );
}
