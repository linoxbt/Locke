import type { Preview } from "@/lib/domain/types";
import type { PlanView } from "@/lib/server/planService";
import type { DepositRow, PlanEvent, Snapshot } from "@/lib/ui/types";

/** GET /api/plans/[id] */
export interface PlanDetail {
  plan: PlanView;
  preview: Preview | null;
  events: PlanEvent[];
  snapshots: Snapshot[];
  deposits: DepositRow[];
  liveError: string | null;
}
