// Veranta (formerly Avantis) on Base: market catalogue, positions and the risk math Locke's keeper
// needs. Pure data and functions, safe to import from browser, server and worker.
//
// Units on the wire: prices, leverage and percentages 1e10; USDC 1e6. Everything returned here is
// in plain numbers (USD, price, x leverage, % per hour).

/** Veranta liquidates a position when its losses plus fees reach this share of its collateral. */
export const LIQ_LOSS_SHARE = 0.85;

const P10 = 1e10;
const USDC = 1e6;

export interface VerantaMarket {
  index: number;
  /** "WTI/USD" */
  symbol: string;
  base: string;
  group: string;
  listed: boolean;
  closeOnly: boolean;
  /** Smallest position Veranta accepts, as collateral × leverage (USD). */
  minPositionUsd: number;
  minLeverage: number;
  maxLeverage: number;
  /** Fees in % of notional. */
  openFeePct: number;
  closeFeePct: number;
  spreadPct: number;
  /** Cost of holding, % of notional per hour: funding plus borrow. Negative means the side is paid. */
  carryPctPerHour: { long: number; short: number };
  /** Open interest headroom, USD of notional. */
  maxOpenInterestUsd: number;
  openInterestUsd: { long: number; short: number };
  marketOpen: boolean;
  /** Pyth Lazer feed id; WTI and Brent have only this. */
  lazerFeedId: number | null;
}

/** One pair from Veranta's /v2/trading snapshot (fields Locke reads). */
export interface RawPair {
  index: number;
  from: string;
  to: string;
  groupIndex: number;
  isPairListed: boolean;
  pairMinLevPosUSDC: number;
  leverages: { minLeverage: number; maxLeverage: number };
  openFeeP: number;
  closeFeeP: number;
  spreadP: number;
  fundingRate?: { long: number; short: number };
  marginFee?: { long: number; short: number };
  pairMaxOI: number;
  openInterest?: { long: number; short: number };
  additionalPairParams2?: { closeOnlyMode?: boolean };
  feed?: { attributes?: { isOpen?: boolean } };
  storagePairParams?: { lazerFeedId?: number };
}

export interface RawTradingSnapshot {
  pairInfos: Record<string, RawPair>;
  groupInfo: Record<string, { name: string }>;
}

export function parseMarkets(snapshot: RawTradingSnapshot): VerantaMarket[] {
  return Object.values(snapshot.pairInfos)
    .map((p) => {
      const funding = p.fundingRate ?? { long: 0, short: 0 };
      const borrow = p.marginFee ?? { long: 0, short: 0 };
      return {
        index: p.index,
        symbol: `${p.from}/${p.to}`,
        base: p.from,
        group: snapshot.groupInfo[String(p.groupIndex)]?.name ?? "",
        listed: p.isPairListed,
        closeOnly: Boolean(p.additionalPairParams2?.closeOnlyMode),
        minPositionUsd: p.pairMinLevPosUSDC,
        minLeverage: p.leverages.minLeverage,
        maxLeverage: p.leverages.maxLeverage,
        openFeePct: p.openFeeP,
        closeFeePct: p.closeFeeP,
        spreadPct: p.spreadP,
        carryPctPerHour: { long: funding.long + borrow.long, short: funding.short + borrow.short },
        maxOpenInterestUsd: p.pairMaxOI,
        openInterestUsd: { long: p.openInterest?.long ?? 0, short: p.openInterest?.short ?? 0 },
        marketOpen: p.feed?.attributes?.isOpen ?? false,
        lazerFeedId: p.storagePairParams?.lazerFeedId || null,
      };
    })
    .sort((a, b) => a.index - b.index);
}

/** True when Locke can open a hedge on this market right now. */
export function tradable(m: VerantaMarket): boolean {
  return m.listed && !m.closeOnly && m.marketOpen;
}

export interface VerantaPosition {
  pairIndex: number;
  index: number;
  /** true = long */
  buy: boolean;
  collateralUsd: number;
  leverage: number;
  openPrice: number;
  /** Signed size in base units (negative for a short). */
  signedSize: number;
  notionalAtOpen: number;
  /** Accrued borrow fee, USD (a cost). */
  rolloverFeeUsd: number;
  /** Accrued funding, USD: positive = the position pays, negative = it is paid. */
  fundingFeeUsd: number;
  /** Veranta's own liquidation price. */
  liquidationPrice: number;
  openedAt: number;
}

/** One position from Veranta's core API GET /user-data?trader=… (raw on-chain scales). */
export interface RawPosition {
  pairIndex: number;
  index: number;
  buy: boolean;
  collateral: string;
  leverage: string;
  openPrice: string;
  coinExposure?: string;
  rolloverFee?: string;
  unrealisedFundingFee?: string;
  liquidationPrice?: string;
  openedAt?: number;
}

export function parsePosition(p: RawPosition): VerantaPosition {
  const collateralUsd = Number(p.collateral) / USDC;
  const leverage = Number(p.leverage) / P10;
  const openPrice = Number(p.openPrice) / P10;
  const notional = collateralUsd * leverage;
  const size = p.coinExposure ? Number(p.coinExposure) / P10 : notional / openPrice;
  return {
    pairIndex: Number(p.pairIndex),
    index: Number(p.index),
    buy: Boolean(p.buy),
    collateralUsd,
    leverage,
    openPrice,
    signedSize: p.buy ? size : -size,
    notionalAtOpen: notional,
    rolloverFeeUsd: Number(p.rolloverFee ?? 0) / USDC,
    fundingFeeUsd: Number(p.unrealisedFundingFee ?? 0) / USDC,
    liquidationPrice: Number(p.liquidationPrice ?? 0) / P10,
    openedAt: Number(p.openedAt ?? 0),
  };
}

/**
 * Liquidation price by Veranta's rule: the price at which losses plus accrued fees reach 85% of
 * collateral. distance = open × (collateral × 0.85 − rollover − funding) / (collateral × leverage).
 */
export function verantaLiquidationPrice(p: Pick<VerantaPosition, "buy" | "collateralUsd" | "leverage" | "openPrice" | "rolloverFeeUsd" | "fundingFeeUsd">): number {
  const room = p.collateralUsd * LIQ_LOSS_SHARE - p.rolloverFeeUsd - p.fundingFeeUsd;
  const distance = (p.openPrice * room) / (p.collateralUsd * p.leverage);
  return Math.max(0, p.buy ? p.openPrice - distance : p.openPrice + distance);
}

/** Price P&L at the mark, before fees, USD. */
export function verantaPnl(p: Pick<VerantaPosition, "signedSize" | "openPrice">, mark: number): number {
  return p.signedSize * (mark - p.openPrice);
}

/**
 * The same margin ratio Locke uses on Strike (maintenance ÷ equity), so its risk levels and alert
 * thresholds carry over: 100% exactly at Veranta's liquidation. Maintenance is the 15% of
 * collateral Veranta lets a position keep; equity is collateral plus P&L less accrued fees.
 */
export function verantaMarginRatio(p: VerantaPosition, mark: number): number {
  const maintenance = p.collateralUsd * (1 - LIQ_LOSS_SHARE);
  const equity = p.collateralUsd + verantaPnl(p, mark) - p.rolloverFeeUsd - p.fundingFeeUsd;
  return equity <= 0 ? Infinity : maintenance / equity;
}

/**
 * Margin to add so the ratio falls to `target` at this mark. Adding collateral c raises both the
 * maintenance (0.15·c) and the equity (c), so c = (target·E − 0.15·C) / (0.15 − target).
 */
export function verantaTopUpUsd(p: VerantaPosition, mark: number, target: number): number {
  const keep = 1 - LIQ_LOSS_SHARE;
  if (target <= keep) throw new Error(`target ratio must be above ${keep}`);
  const equity = p.collateralUsd + verantaPnl(p, mark) - p.rolloverFeeUsd - p.fundingFeeUsd;
  const c = (target * equity - keep * p.collateralUsd) / (keep - target);
  return Math.max(0, Math.ceil(c * 100) / 100);
}

/** Holding cost per day at the mark for this side, USD (negative = the hedge is paid). */
export function verantaCarryPerDay(m: VerantaMarket, buy: boolean, notionalUsd: number): number {
  return (notionalUsd * (buy ? m.carryPctPerHour.long : m.carryPctPerHour.short) * 24) / 100;
}
