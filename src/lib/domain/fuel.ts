// Fuel reference data and the maths behind the operating-costs plan's defaults. Pure: shared by
// the form (browser), sizing and validation (server), and tests.
//
// Crude share. The plan models the pump price as p × (1 + c × crude move): only the share c moves
// with crude. Locke's default for c is the share of today's pump price that physically is crude:
// the crude in one unit of fuel (WTI per litre × the fuel's crude content) in local currency,
// divided by the pump price. Taxes, distribution and margins sit in the rest of the price.

export type FuelType = "diesel" | "petrol" | "kerosene" | "lpg";
export type CountryCode = "NG" | "KE" | "GH" | "PH";

/** Litres in a barrel of crude. */
export const LITRES_PER_BARREL = 158.987;

export const FUELS: Record<FuelType, { label: string; short: string; crudePerLitre: number; note: string }> = {
  diesel: { label: "Diesel", short: "Diesel", crudePerLitre: 1, note: "Refined from crude; about a litre of crude per litre." },
  petrol: { label: "Petrol", short: "Petrol", crudePerLitre: 1, note: "Refined from crude; about a litre of crude per litre." },
  kerosene: { label: "Kerosene / jet fuel", short: "Kerosene", crudePerLitre: 1, note: "A middle distillate like diesel; about a litre of crude per litre." },
  lpg: {
    label: "Cooking gas (LPG)",
    short: "LPG",
    // By energy content: a litre of LPG carries about two-thirds of a litre of crude's energy.
    crudePerLitre: 0.67,
    note: "Priced off propane and butane contracts, which follow crude loosely; counted by energy content.",
  },
};

export const COUNTRIES: Record<CountryCode, { name: string; currency: string; pricing: string }> = {
  NG: { name: "Nigeria", currency: "NGN", pricing: "Market-priced since the 2023 subsidy removal, so crude and naira moves reach the pump within weeks." },
  KE: { name: "Kenya", currency: "KES", pricing: "EPRA sets maximum prices on the 14th of each month from import costs, so crude moves arrive about a month late." },
  GH: { name: "Ghana", currency: "GHS", pricing: "The NPA reviews prices in two windows a month, on the 1st and the 16th." },
  PH: { name: "Philippines", currency: "PHP", pricing: "Deregulated: oil companies change pump prices every week." },
};

export interface PumpReference {
  /** Local currency per litre. */
  price: number;
  monthAgo: number;
  threeMonthsAgo: number;
  yearAgo: number;
  date: string;
}

/** Retail prices per litre from GlobalPetrolPrices.com (official and industry sources), snapshot of 19 Oct 2026. */
export const PUMP_SOURCE = { name: "GlobalPetrolPrices.com", date: "2026-10-19" };
export const PUMP_PRICES: Record<CountryCode, Partial<Record<FuelType, PumpReference>>> = {
  NG: {
    diesel: { price: 1790.25, monthAgo: 1825, threeMonthsAgo: 1620, yearAgo: 955.75, date: "2026-10-19" },
    petrol: { price: 1348.5, monthAgo: 1331.5, threeMonthsAgo: 1270, yearAgo: 874.5, date: "2026-10-19" },
    kerosene: { price: 1902.5, monthAgo: 1830, threeMonthsAgo: 1592.5, yearAgo: 996.25, date: "2026-10-19" },
    lpg: { price: 1186.25, monthAgo: 1132.5, threeMonthsAgo: 1018.75, yearAgo: 890, date: "2026-10-19" },
  },
  KE: {
    diesel: { price: 226.43, monthAgo: 216.57, threeMonthsAgo: 221.57, yearAgo: 170.18, date: "2026-10-19" },
    petrol: { price: 225.5, monthAgo: 212.61, threeMonthsAgo: 212.61, yearAgo: 183.11, date: "2026-10-19" },
    kerosene: { price: 218.55, monthAgo: 190.09, threeMonthsAgo: 190.09, yearAgo: 153.49, date: "2026-10-19" },
  },
  GH: {
    diesel: { price: 18.46, monthAgo: 17.26, threeMonthsAgo: 15.97, yearAgo: 13.85, date: "2026-10-19" },
    petrol: { price: 18.98, monthAgo: 17.97, threeMonthsAgo: 16.31, yearAgo: 15.25, date: "2026-10-19" },
  },
  PH: {
    diesel: { price: 91.4, monthAgo: 94.5, threeMonthsAgo: 77.9, yearAgo: 55.45, date: "2026-10-19" },
    petrol: { price: 88.9, monthAgo: 91.4, threeMonthsAgo: 81.7, yearAgo: 59.9, date: "2026-10-19" },
    kerosene: { price: 124.4, monthAgo: 124.5, threeMonthsAgo: 108.9, yearAgo: 76.74, date: "2026-10-19" },
    lpg: { price: 47.4, monthAgo: 43.73, threeMonthsAgo: 43.73, yearAgo: 41.6, date: "2026-10-19" },
  },
};

export function isFuelType(v: unknown): v is FuelType {
  return v === "diesel" || v === "petrol" || v === "kerosene" || v === "lpg";
}

export function isCountry(v: unknown): v is CountryCode {
  return v === "NG" || v === "KE" || v === "GH" || v === "PH";
}

/** Local-currency cost of the crude in one litre of this fuel. */
export function crudeCostPerLitre(fuel: FuelType, wtiUsd: number, fxRate: number): number {
  return (wtiUsd / LITRES_PER_BARREL) * FUELS[fuel].crudePerLitre * fxRate;
}

/** Calibrated crude share (%, whole number, 5–95): crude's cost in a litre over the pump price. */
export function calibratedCrudeShare(fuel: FuelType, wtiUsd: number, fxRate: number, pumpPrice: number): number | null {
  if (!(wtiUsd > 0 && fxRate > 0 && pumpPrice > 0)) return null;
  const share = (100 * crudeCostPerLitre(fuel, wtiUsd, fxRate)) / pumpPrice;
  return Math.min(95, Math.max(5, Math.round(share)));
}

export type BudgetResult =
  | { ok: true; coverPct: number; billNow: number; billAtStress: number }
  | { ok: false; reason: "below_today" | "no_hedge_needed"; billNow: number; billAtStress: number };

/**
 * Budget mode: the smallest share of the crude-linked cost to hedge so that, if crude rises by
 * stressPct, the monthly bill stays at or under the budget. With cover s the hedged bill at a
 * crude move r is B × (1 + c·r·(1 − s)), so s = 1 − (budget/B − 1) / (c·r).
 */
export function budgetCover(
  p: { litresPerMonth: number; pumpPrice: number; crudeSharePct: number },
  monthlyMax: number,
  stressPct: number
): BudgetResult {
  const billNow = p.litresPerMonth * p.pumpPrice;
  const cr = (p.crudeSharePct / 100) * (stressPct / 100);
  const billAtStress = billNow * (1 + cr);
  if (monthlyMax < billNow) return { ok: false, reason: "below_today", billNow, billAtStress };
  if (cr <= 0 || monthlyMax >= billAtStress) return { ok: false, reason: "no_hedge_needed", billNow, billAtStress };
  const s = 1 - (monthlyMax / billNow - 1) / cr;
  return { ok: true, coverPct: Math.min(100, Math.max(1, Math.ceil(s * 100))), billNow, billAtStress };
}

/**
 * What a currency move alone does to the monthly bill: the crude-linked part is priced in dollars,
 * so it moves with the exchange rate even when crude doesn't. A hedge on WTI can't offset this.
 */
export function fxBillImpact(p: { litresPerMonth: number; pumpPrice: number; crudeSharePct: number }, weakenPct: number): number {
  return p.litresPerMonth * p.pumpPrice * (p.crudeSharePct / 100) * (weakenPct / 100);
}

/** % change helper: from → to. */
export function pctChange(from: number, to: number): number {
  return from > 0 ? (to / from - 1) * 100 : 0;
}
