// Shared domain types. Pure data, safe to import from browser, server and worker.

/** How close a hedge's margin is to trouble. */
export type RiskLevel = "ok" | "watch" | "action" | "margin_call" | "reduce_only" | "liquidation";
