import {
  fetchFreeUsdtBalance,
  fetchSpotSymbolFilters,
} from "../binance.browser";
import { parseMarketRules, preflightMarketBuy } from "./binance-preflight";
import { clientOrderIdForEvent } from "./client-order-id";
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
  executableUsdt: number;
  estimatedBaseQty: number;
  remainingPlannedUsdt: number;
  ok: boolean;
  reason: string | null;
}

export interface BuyDryRunDependencies {
  getFreeUsdt: () => Promise<number>;
  getSymbolFilters: (symbol: string) => Promise<Awaited<ReturnType<typeof fetchSpotSymbolFilters>>>;
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
  },
): Promise<BuyDryRunResult> {
  if (order.status !== "pending" && order.status !== "partially_filled") {
    throw new Error(`待买订单状态为 ${order.status}，不允许进入买入预检`);
  }
  if (!Number.isFinite(remainingAssetCapUsdt) || remainingAssetCapUsdt < 0) {
    throw new Error("单币剩余成本额度无效");
  }

  const [freeUsdt, symbolInfo] = await Promise.all([
    dependencies.getFreeUsdt(),
    dependencies.getSymbolFilters(order.symbol),
  ]);
  const rules = parseMarketRules(symbolInfo);
  const requestedUsdt = Math.min(order.remainingUsdt, remainingAssetCapUsdt);
  const preflight = preflightMarketBuy(rules, requestedUsdt, freeUsdt, order.referencePrice);
  const executableUsdt = preflight.ok && preflight.quoteOrderQty !== null
    ? Number(preflight.quoteOrderQty)
    : 0;

  return {
    mode: BINANCE_ORDER_MODE,
    submitted: false,
    queueOrderId: order.id,
    clientOrderId: clientOrderIdForEvent(order.eventKey, order.attemptCount),
    symbol: order.symbol,
    plannedUsdt: order.remainingUsdt,
    remainingAssetCapUsdt,
    freeUsdt,
    executableUsdt,
    estimatedBaseQty: preflight.estimatedBaseQty,
    remainingPlannedUsdt: Math.max(0, order.remainingUsdt - executableUsdt),
    ok: preflight.ok,
    reason: preflight.reason,
  };
}

/** Explicit fail-closed guard for any UI or caller attempting live submission. */
export function assertLiveOrderSubmissionDisabled(): never {
  if (LIVE_ORDER_SUBMISSION_ENABLED) {
    throw new Error("Live order submission requires a separately reviewed server-side executor");
  }
  throw new Error("实盘下单尚未启用：当前仅允许 DRY_RUN 预检，不会发送 Binance 订单请求");
}
