import {
  fetchSpotSymbolFilters,
  LIVE_SPOT_ORDER_SUBMISSION_ENABLED,
  submitSpotMarketBuy,
} from "../binance.browser";
import { parseMarketRules } from "./binance-preflight";
import { prepareQueuedBuyDryRun } from "./binance-order.browser";
import { clientOrderIdForEvent } from "./client-order-id";
import {
  claimBuyOrderSubmission,
  listBuyOrders,
  markBuyOrderReconcileRequired,
  reserveBuyFunds,
} from "./store.browser";

/** Real Spot order submission stays disabled until the user explicitly enables it. */
export const BUY_SUBMISSION_MODE = "DRY_RUN" as const;

export interface BuyOrderSubmissionResult {
  submitted: boolean;
  orderId: string | null;
  attempt: number | null;
  clientOrderId: string | null;
  exchangeOrderId: number | null;
  exchangeStatus: string | null;
  reason: string | null;
}

/**
 * One-shot BUY submission orchestration.
 *
 * Safety order:
 * 1) fresh read-only preflight;
 * 2) reserve the exact quote amount locally;
 * 3) atomically claim a unique attempt in IndexedDB;
 * 4) send one MARKET BUY with deterministic newClientOrderId;
 * 5) leave the queue in reconciliation hold until the exchange order and fills
 *    are read back and verified by syncBuyOrderFromBinance.
 *
 * An ambiguous POST is never retried here.
 */
export async function submitQueuedBuyOrder(
  queuedOrderId: string,
  remainingAssetCapUsdt: number,
): Promise<BuyOrderSubmissionResult> {
  if (!LIVE_SPOT_ORDER_SUBMISSION_ENABLED) {
    throw new Error("现货实盘买入尚未启用；当前不会发送 Binance 订单 POST");
  }
  const orders = await listBuyOrders();
  const order = orders.find((item) => item.id === queuedOrderId);
  if (!order) throw new Error("找不到待买订单");
  if (order.status !== "pending" && order.status !== "partially_filled") {
    throw new Error(`待买订单状态为 ${order.status}，不允许提交买单`);
  }

  const preview = await prepareQueuedBuyDryRun(order, remainingAssetCapUsdt);
  if (!preview.ok || !preview.quoteOrderQty || preview.executableUsdt <= 0) {
    throw new Error(preview.reason ?? "买入预检未通过");
  }

  const symbolInfo = await fetchSpotSymbolFilters(preview.symbol);
  const rules = parseMarketRules(symbolInfo);
  if (rules.quoteAsset !== "USDT" || rules.status !== "TRADING") {
    throw new Error("交易对状态或报价资产不符合现货买入要求");
  }
  const reservation = await reserveBuyFunds({
    orderId: order.id,
    symbol: preview.symbol,
    requestedUsdt: preview.executableUsdt,
    observedFreeUsdt: preview.freeUsdt,
    minNotionalUsdt: rules.minNotional,
  });
  const reservedUsdt = reservation.reservation?.reservedUsdt ?? 0;
  if (!reservation.plan.ok || reservedUsdt + 1e-8 < preview.executableUsdt) {
    throw new Error("本地 USDT 预留不足以覆盖本次买单；未提交 Binance 订单");
  }

  const claimed = await claimBuyOrderSubmission(order.id);
  const clientOrderId = clientOrderIdForEvent(order.eventKey, claimed.attempt);
  try {
    const response = await submitSpotMarketBuy({
      symbol: preview.symbol,
      quoteOrderQty: preview.quoteOrderQty,
      clientOrderId,
    });
    await markBuyOrderReconcileRequired(
      order.id,
      `Binance 已受理订单 ${response.orderId}（${response.status}）；等待按 clientOrderId 对账成交`,
    );
    return {
      submitted: true,
      orderId: order.id,
      attempt: claimed.attempt,
      clientOrderId,
      exchangeOrderId: response.orderId,
      exchangeStatus: response.status,
      reason: "订单请求已返回；必须完成交易所订单与逐笔成交对账后才能更新队列",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "买单提交结果不明确";
    await markBuyOrderReconcileRequired(order.id, reason.slice(0, 500));
    return {
      submitted: false,
      orderId: order.id,
      attempt: claimed.attempt,
      clientOrderId,
      exchangeOrderId: null,
      exchangeStatus: null,
      reason: `${reason}。已冻结该订单的本次 attempt，禁止自动重发；请先按 clientOrderId 对账`,
    };
  }
}
