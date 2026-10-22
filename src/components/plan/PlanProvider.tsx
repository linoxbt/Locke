"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { PlanDetail } from "@/lib/server/queries";
import { api, errorMessage } from "@/lib/ui/api";

const WAITING = new Set(["funding", "opening", "closing"]);

interface Ctx {
  detail: PlanDetail;
  error: string | null;
  /** Re-fetch now (after an action). Nudges the plan forward on Strike first when it's waiting. */
  refresh(): Promise<PlanDetail | null>;
}

const PlanContext = createContext<Ctx | null>(null);

/**
 * Holds one plan's live state for every page under /plans/[id]. The server layout renders
 * the first copy; this keeps it fresh (5 s while waiting on Strike, 10 s otherwise).
 */
export function PlanProvider({ initial, children }: { initial: PlanDetail; children: React.ReactNode }) {
  const [detail, setDetail] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(initial);
  latest.current = detail;
  const id = initial.plan.id;

  const refresh = useCallback(async () => {
    try {
      const cur = latest.current;
      const pending = WAITING.has(cur.plan.status) || cur.deposits.some((x) => x.status === "submitted" || x.status === "credited");
      if (pending) await api(`/api/plans/${id}/sync`, { body: {} }).catch(() => {});
      const next = await api<PlanDetail>(`/api/plans/${id}`);
      setDetail(next);
      setError(null);
      return next;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    }
  }, [id]);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      timer = setTimeout(
        async () => {
          if (document.visibilityState === "visible") await refresh();
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
