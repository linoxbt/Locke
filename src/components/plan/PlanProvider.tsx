"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { PlanDetail } from "@/lib/server/queries";
import { resumePendingDeposits } from "../DepositFlow";
import { api, errorMessage } from "@/lib/ui/api";

const WAITING = new Set(["funding", "opening", "closing"]);
const PREVIEWED = new Set(["draft", "funding"]);
/** A draft's preview is re-priced this often while the page is open. */
const REPRICE_MS = 60_000;

/** PlanDetail as the client reads it, with the newer fields optional until every server sends them. */
export type PlanDetailView = Omit<PlanDetail, "plan"> & {
  plan: PlanDetail["plan"] & {
    /** Locke's client order id for the opening order ("locke-<uuid>-open-1"). */
    openOrderId?: string | null;
    /** Costs plans: when the next one-month reduce is due (ISO). */
    nextMonthlyReduceAt?: string | null;
  };
  /** Set when the preview couldn't be priced (Strike down); `preview` is then null. */
  previewError?: string | null;
};

interface Ctx {
  detail: PlanDetailView;
  error: string | null;
  /** Re-fetch now (after an action). Nudges the plan forward on Strike first when it's waiting. */
  refresh(opts?: { preview?: boolean }): Promise<PlanDetailView | null>;
}

const PlanContext = createContext<Ctx | null>(null);

/**
 * Holds one plan's live state for every page under /plans/[id]. The server layout renders
 * the first copy; this keeps it fresh (5 s while waiting on Strike, 10 s otherwise). Polls keep
 * the preview they already have instead of re-pricing it, except a draft's, which is re-priced
 * every minute; a slow response never overwrites a newer one.
 */
export function PlanProvider({ initial, children }: { initial: PlanDetailView; children: React.ReactNode }) {
  const [detail, setDetail] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(initial);
  latest.current = detail;
  const seq = useRef(0);
  const priced = useRef(Date.now());
  const id = initial.plan.id;

  const refresh = useCallback(
    async (opts?: { preview?: boolean }) => {
      const mine = ++seq.current;
      try {
        const cur = latest.current;
        const pending = WAITING.has(cur.plan.status) || cur.deposits.some((x) => x.status === "submitted" || x.status === "credited");
        if (pending) await api(`/api/plans/${id}/sync`, { body: {} }).catch(() => {});
        const withPreview = opts?.preview ?? !cur.preview;
        const next = await api<PlanDetailView>(`/api/plans/${id}${withPreview ? "" : "?preview=0"}`);
        if (withPreview) priced.current = Date.now();
        if (mine !== seq.current) return next; // a newer request is on its way
        const merged = next.preview || !PREVIEWED.has(next.plan.status) ? next : { ...next, preview: latest.current.preview };
        setDetail(merged);
        setError(null);
        return merged;
      } catch (e) {
        if (mine === seq.current) setError(errorMessage(e));
        return null;
      }
    },
    [id]
  );

  useEffect(() => {
    // Deliver any deposit hash an earlier visit couldn't, then pick up the result.
    void resumePendingDeposits().then((sent) => {
      if (sent) void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      timer = setTimeout(
        async () => {
          if (document.visibilityState === "visible") {
            const reprice = latest.current.plan.status === "draft" && Date.now() - priced.current >= REPRICE_MS;
            await refresh(reprice ? { preview: true } : undefined);
          }
          if (!stop) loop();
        },
        WAITING.has(latest.current.plan.status) ? 5000 : 10_000
      );
    };
    loop();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [refresh]);

  return <PlanContext.Provider value={{ detail, error, refresh }}>{children}</PlanContext.Provider>;
}

export function usePlan(): Ctx {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error("usePlan outside PlanProvider");
  return ctx;
}
