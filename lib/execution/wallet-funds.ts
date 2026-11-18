/**
 * Binance Spot + Simple Earn USDT wallet model.
 * Flexible Earn may be used for Spot trading in Binance's supported Spot UI
 * flow; API execution still needs a separately verified redemption/order path.
 * Locked Earn is tracked but is not treated as immediately tradable.
 */
export interface UsdtWalletBuckets {
  spotFreeUsdt: number;
  spotLockedUsdt: number;
  flexibleEarnUsdt: number;
  flexibleEarnRedeemingUsdt: number;
  flexibleEarnFrozenUsdt: number;
  lockedEarnUsdt: number;
  lockedEarnRedeemingUsdt: number;
  activeBuyReservationsUsdt: number;
}

export interface UsdtWalletSummary extends UsdtWalletBuckets {
  totalTrackedUsdt: number;
  spotFreeAfterReservationsUsdt: number;
  flexibleEarnAvailableUsdt: number;
  flexibleEarnPlanningUsdt: number;
  totalPlanningUsdt: number;
}

function amount(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} 必须是非负有限数值`);
  }
  return value;
}

export function summarizeUsdtWallets(input: UsdtWalletBuckets): UsdtWalletSummary {
  for (const [key, value] of Object.entries(input)) amount(value, key);
  const spotFreeAfterReservationsUsdt = Math.max(
    0, input.spotFreeUsdt - input.activeBuyReservationsUsdt,
  );
  const flexibleEarnAvailableUsdt = Math.max(
    0, input.flexibleEarnUsdt - input.flexibleEarnRedeemingUsdt - input.flexibleEarnFrozenUsdt,
  );
  // Planning visibility includes flexible Earn because Binance supports using
  // eligible flexible positions for Spot orders; locked products are excluded.
  const flexibleEarnPlanningUsdt = flexibleEarnAvailableUsdt;
  const totalTrackedUsdt = input.spotFreeUsdt + input.spotLockedUsdt +
    input.flexibleEarnUsdt + input.lockedEarnUsdt;
  return {
    ...input,
    totalTrackedUsdt,
    spotFreeAfterReservationsUsdt,
    flexibleEarnAvailableUsdt,
    flexibleEarnPlanningUsdt,
    totalPlanningUsdt: spotFreeAfterReservationsUsdt + flexibleEarnPlanningUsdt,
  };
}

export interface SimpleEarnPositionRow {
  asset: string;
  amount: string;
  redeemingAmt?: string;
  freezeAmount?: string;
  [key: string]: unknown;
}

export interface SimpleEarnPositionPage {
  total: number;
  rows: SimpleEarnPositionRow[];
}

/** Aggregate USDT from a paged Simple Earn position response. */
export function sumSimpleEarnUsdtPositions(rows: SimpleEarnPositionRow[]): {
  totalUsdt: number;
  redeemingUsdt: number;
  frozenUsdt: number;
} {
  return rows.filter((row) => row.asset === "USDT").reduce((sum, row) => {
    const total = Number(row.amount);
    const redeeming = Number(row.redeemingAmt ?? "0");
    const frozen = Number(row.freezeAmount ?? "0");
    amount(total, "Simple Earn USDT amount");
    amount(redeeming, "Simple Earn USDT redeeming amount");
    amount(frozen, "Simple Earn USDT frozen amount");
    if (redeeming + frozen > total + 1e-10) {
      throw new Error("Simple Earn USDT 冻结/赎回中数量超过持仓总量");
    }
    sum.totalUsdt += total;
    sum.redeemingUsdt += redeeming;
    sum.frozenUsdt += frozen;
    return sum;
  }, { totalUsdt: 0, redeemingUsdt: 0, frozenUsdt: 0 });
}

/**
 * Allocate a queued buy from Spot first. Only the shortfall may be requested
 * from eligible Simple Earn Flexible holdings. This is a plan only: it does
 * not redeem, transfer, or submit an order.
 */
export interface BuyFundingPlan {
  requestedUsdt: number;
  spotToUseUsdt: number;
  flexibleEarnToRedeemUsdt: number;
  unfundedUsdt: number;
}

export function planSpotFirstBuyFunding(
  requestedUsdt: number,
  spotFreeAfterReservationsUsdt: number,
  flexibleEarnAvailableUsdt: number,
): BuyFundingPlan {
  amount(requestedUsdt, "买入计划金额");
  amount(spotFreeAfterReservationsUsdt, "现货可用 USDT");
  amount(flexibleEarnAvailableUsdt, "活期理财可用 USDT");
  const spotToUseUsdt = Math.min(requestedUsdt, spotFreeAfterReservationsUsdt);
  const shortfall = Math.max(0, requestedUsdt - spotToUseUsdt);
  const flexibleEarnToRedeemUsdt = Math.min(shortfall, flexibleEarnAvailableUsdt);
  return {
    requestedUsdt,
    spotToUseUsdt,
    flexibleEarnToRedeemUsdt,
    unfundedUsdt: Math.max(0, shortfall - flexibleEarnToRedeemUsdt),
  };
}
