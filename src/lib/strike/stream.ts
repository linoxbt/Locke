// Reading Strike's user stream. Pure, so the worker's parsing can be tested on its own.

const LIQUIDATION_REASONS = new Set(["LIQUIDATION", "ADL", "PARTIAL_LIQUIDATED", "FULLY_LIQUIDATED"]);

/**
 * Strike's user stream marks liquidations as: ACCOUNT_UPDATE with reason type `e` (or `r`) LIQUIDATION
 * or ADL; ORDER_TRADE_UPDATE with auto-close type `act` LIQUIDATION or ADL, or a close reason `cr`
 * naming one. A user's own close also has a close reason, so `cr` counts only when it says so.
 */
export function liquidationReason(kind: string, data: any): string | null {
  const up = (v: unknown) => (typeof v === "string" ? v.toUpperCase() : "");
  if (kind === "ACCOUNT_UPDATE") {
    for (const v of [up(data?.e), up(data?.r), up(data?.a?.m)]) if (LIQUIDATION_REASONS.has(v)) return v;
    return null;
  }
  if (kind === "ORDER_TRADE_UPDATE") {
    const act = up(data?.act ?? data?.o?.act);
    if (LIQUIDATION_REASONS.has(act)) return act;
    const cr = up(data?.cr ?? data?.o?.cr);
    if (/LIQUIDAT|ADL|BANKRUPT/.test(cr)) return cr;
  }
  return null;
}
