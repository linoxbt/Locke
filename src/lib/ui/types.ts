// Response shapes of Locke's own API, for the client.
export type { PlanView } from "@/lib/server/planService";
export type { Preview, Scenario, PlanType, CostsInputs, HoldingsInputs } from "@/lib/domain/types";

export interface PlanEvent {
  id: number;
  level: string;
  message: string;
  created_at: string;
}

export interface Snapshot {
  mark: number;
  ratio: number | null;
  headline: number | null;
  created_at: string;
}

export interface DepositRow {
  id: string;
  purpose: "open" | "topup";
  status: string;
  lovelace: number;
  usd_value: number;
  tx_hash: string | null;
  created_at: string;
}
