import {
  fetchFreeUsdtBalance,
  fetchSpotSymbolFilters,
} from "../binance.browser";
import { parseMarketRules, preflightMarketBuy } from "./binance-preflight";
import { clientOrderIdForEvent } from "./client-order-id";
import { listBuyFundsReservations, reserveBuyFunds } from "./store.browser";
import { planBuyFundsReservation, type BuyFundsReservation } from "./fund-reservation";
import type { QueuedBuyOrder } from "./types";

/**
 * Phase 4 safety boundary:
 * this module can prepare and explain an order, but it cannot submit one.
 * Keep this false until a separately reviewed server-side signer/executor exists.
 */
export const LIVE_ORDER_SUBMISSION_ENABLED = false as const;
export const BINANCE_ORDER_MODE = "DRY_RUN" as const;

export interface BuyDryRunResult {
  mode: typeof BINANCE_ORDER_MODE;
  submitted: false;
  queueOrderId: string;
  clientOrderId: string;
  symbol: string;
  plannedUsdt: number;
  remainingAssetCapUsdt: number;
  freeUsdt: number;
  unreservedFreeUsdt: number;
  otherReservedUsdt: number;
  proposedReserveUsdt: number;
  executableUsdt: number;
  estimatedBaseQty: number;
  remainingPlannedUsdt: number;
  ok: boolean;
  reason: string | null;
}

export interface BuyDryRunDependencies {
  getFreeUsdt: () => Promise<number>;
  getSymbolFilters: (symbol: string) => Promise<Awaited<ReturnType<typeof fetchSpotSymbolFilters>>>;
  getReservations?: () => Promise<BuyFundsReservation[]>;
}

/**
 * Re-checks live USDT free, the per-asset remaining cost cap and current
 * exchange filters immediately before a future execution attempt.
 *
 * This function is intentionally read-only: no order POST, cancellation,
 * balance reservation or queue mutation occurs here.
 */
export async function prepareQueuedBuyDryRun(
  order: QueuedBuyOrder,
  remainingAssetCapUsdt: number,
  dependencies: BuyDryRunDependencies = {
    getFreeUsdt: fetchFreeUsdtBalance,
    getSymbolFilters: fetchSpotSymbolFilters,
    getReservations: listBuyFundsReservations,
  },
): Promise<BuyDryRunResult> {
  if (order.status !== "pending" && order.status !== "partially_filled") {
    throw new Error(`待买订单状态为 ${order.status}，不允许进入买入预检`);
  }
  if (!Number.isFinite(remainingAssetCapUsdt) || remainingAssetCapUsdt < 0) {
    throw new Error("单币剩余成本额度无效");
  }

  const pair = order.symbol.endsWith(order.quoteAsset)
    ? order.symbol
    : `${order.symbol}${order.quoteAsset}`;
  const [freeUsdt, symbolInfo, reservations] = await Promise.all([
    dependencies.getFreeUsdt(),
    dependencies.getSymbolFilters(pair),
    dependencies.getReservations?.() ?? Promise.resolve([]),
  ]);
  const rules = parseMarketRules(symbolInfo);
  const requestedUsdt = Math.min(order.remainingUsdt, remainingAssetCapUsdt);
  const reservationPlan = planBuyFundsReservation({
    orderId: order.id,
    requestedUsdt,
    observedFreeUsdt: freeUsdt,
    activeReservations: reservations,
    minNotionalUsdt: rules.minNotional,
  });
  const preflight = reservationPlan.ok
    ? preflightMarketBuy(rules, reservationPlan.reserveUsdt, reservationPlan.availableUsdt, order.referencePrice)
    : null;
  const executableUsdt = preflight?.ok && preflight.quoteOrderQty !== null
    ? Number(preflight.quoteOrderQty)
    : 0;

  return {
    mode: BINANCE_ORDER_MODE,
    submitted: false,
    queueOrderId: order.id,
    clientOrderId: clientOrderIdForEvent(order.eventKey, order.attemptCount),
    symbol: pair,
    plannedUsdt: order.remainingUsdt,
    remainingAssetCapUsdt,
    freeUsdt,
    unreservedFreeUsdt: reservationPlan.availableUsdt,
    otherReservedUsdt: reservationPlan.totalReservedUsdt,
    proposedReserveUsdt: reservationPlan.ok ? reservationPlan.reserveUsdt : 0,
    executableUsdt,
    estimatedBaseQty: preflight?.estimatedBaseQty ?? 0,
    remainingPlannedUsdt: Math.max(0, order.remainingUsdt - executableUsdt),
    ok: Boolean(reservationPlan.ok && preflight?.ok),
    reason: reservationPlan.reason ?? preflight?.reason ?? null,
  };
}

/** Explicit fail-closed guard for any UI or caller attempting live submission. */
export function assertLiveOrderSubmissionDisabled(): never {
  if (LIVE_ORDER_SUBMISSION_ENABLED) {
    throw new Error("Live order submission requires a separately reviewed server-side executor");
  }
  throw new Error("实盘下单尚未启用：当前仅允许 DRY_RUN 预检，不会发送 Binance 订单请求");
}


export interface BuyReservationResult {
  mode: typeof BINANCE_ORDER_MODE;
  submitted: false;
  queueOrderId: string;
  symbol: string;
  requestedUsdt: number;
  observedFreeUsdt: number;
  reservedUsdt: number;
  remainingPlannedUsdt: number;
  ok: boolean;
  reason: string | null;
}

/**
 * Locally reserves USDT for one queued order after a fresh account/filter read.
 * This is not an exchange lock and does not submit an order.
 */
export async function reserveQueuedBuyFundsDryRun(
  order: QueuedBuyOrder,
  remainingAssetCapUsdt: number,
  dependencies: BuyDryRunDependencies = {
    getFreeUsdt: fetchFreeUsdtBalance,
    getSymbolFilters: fetchSpotSymbolFilters,
  },
): Promise<BuyReservationResult> {
  if (order.status !== "pending" && order.status !== "partially_filled") {
    throw new Error(`待买订单状态为 ${order.status}，不允许预留资金`);
  }
  if (!Number.isFinite(remainingAssetCapUsdt) || remainingAssetCapUsdt < 0) {
    throw new Error("单币剩余成本额度无效");
  }
  const pair = order.symbol.endsWith(order.quoteAsset)
    ? order.symbol
    : `${order.symbol}${order.quoteAsset}`;
  const [freeUsdt, symbolInfo, reservations] = await Promise.all([
    dependencies.getFreeUsdt(),
    dependencies.getSymbolFilters(pair),
    dependencies.getReservations?.() ?? listBuyFundsReservations(),
  ]);
  const rules = parseMarketRules(symbolInfo);
  const requestedUsdt = Math.min(order.remainingUsdt, remainingAssetCapUsdt);
  const reservationPlan = planBuyFundsReservation({
    orderId: order.id,
    requestedUsdt,
    observedFreeUsdt: freeUsdt,
    activeReservations: reservations,
    minNotionalUsdt: rules.minNotional,
  });
  if (!reservationPlan.ok) {
    return {
      mode: BINANCE_ORDER_MODE, submitted: false, queueOrderId: order.id,
      symbol: pair, requestedUsdt, observedFreeUsdt: freeUsdt, reservedUsdt: 0,
      remainingPlannedUsdt: order.remainingUsdt, ok: false,
      reason: reservationPlan.reason,
    };
  }
  const preflight = preflightMarketBuy(
    rules,
    reservationPlan.reserveUsdt,
    reservationPlan.availableUsdt,
    order.referencePrice,
  );
  if (!preflight.ok) {
    return {
      mode: BINANCE_ORDER_MODE, submitted: false, queueOrderId: order.id,
      symbol: pair, requestedUsdt, observedFreeUsdt: freeUsdt, reservedUsdt: 0,
      remainingPlannedUsdt: order.remainingUsdt, ok: false,
      reason: preflight.reason,
    };
  }
  const result = await reserveBuyFunds({
    orderId: order.id,
    symbol: pair,
    requestedUsdt,
    observedFreeUsdt: freeUsdt,
    minNotionalUsdt: rules.minNotional,
  });
  const reservedUsdt = result.reservation?.reservedUsdt ?? 0;
  return {
    mode: BINANCE_ORDER_MODE,
    submitted: false,
    queueOrderId: order.id,
    symbol: pair,
    requestedUsdt,
    observedFreeUsdt: freeUsdt,
    reservedUsdt,
    remainingPlannedUsdt: Math.max(0, order.remainingUsdt - reservedUsdt),
    ok: result.plan.ok,
    reason: result.plan.reason,
  };
}
