/**
 * Read-only Binance order reconciliation.
 *
 * Converts an exchange order snapshot + its actual fills into monotonic local
 * execution/trade records. This module never submits, cancels, or retries orders.
 */
import type { BinanceSpotOrderSnapshot, BinanceSpotTrade } from "../binance.browser";
import type { ExecutionRecord, ExecutionStatus } from "./execution-core";
import type { StoredTrade } from "./store";

const EPSILON = 1e-8;

export interface ReconciliationResult {
  execution: ExecutionRecord;
  trades: StoredTrade[];
  fillsComplete: boolean;
  remainingQuoteUsdt: number;
  quoteCommissionUsdt: number;
  note?: string;
}

export function reconcileSpotOrder(input: {
  current: ExecutionRecord;
  order: BinanceSpotOrderSnapshot;
  trades: BinanceSpotTrade[];
  plannedQuoteUsdt: number;
  quoteAsset: string;
}): ReconciliationResult {
  const { current, order } = input;
  if (!current.symbol || order.symbol !== current.symbol || order.clientOrderId !== current.clientOrderId) {
    throw new Error("订单快照与本地执行记录不匹配");
  }
  if (!Number.isFinite(order.orderId)) throw new Error("Binance 订单 ID 无效");

  const executedQty = Number(order.executedQty);
  const cumulativeQuote = Number(order.cummulativeQuoteQty);
  const originalQty = Number(order.origQty);
  if (![executedQty, cumulativeQuote, originalQty, input.plannedQuoteUsdt].every(Number.isFinite) ||
      executedQty < 0 || cumulativeQuote < 0 || originalQty <= 0 || input.plannedQuoteUsdt < 0) {
    throw new Error("Binance 订单累计数量或金额无效");
  }
  if (Math.abs(originalQty - current.requestedQty) > Math.max(EPSILON, originalQty * EPSILON)) {
    throw new Error("交易所原始委托数量与本地请求数量不一致");
  }

  const matched = input.trades.filter((trade) =>
    trade.symbol === order.symbol && trade.orderId === order.orderId
  );
  for (const trade of matched) {
    if (![trade.price, trade.qty, trade.quoteQty, trade.commission, trade.time].every(Number.isFinite) ||
        trade.price <= 0 || trade.qty <= 0 || trade.quoteQty < 0 || trade.commission < 0) {
      throw new Error("成交明细包含无效数值");
    }
  }

  const fillsQty = matched.reduce((sum, trade) => sum + trade.qty, 0);
  const fillsQuote = matched.reduce((sum, trade) => sum + trade.quoteQty, 0);
  const quoteCommissionUsdt = matched.reduce(
    (sum, trade) => sum + (trade.commissionAsset === input.quoteAsset ? trade.commission : 0),
    0,
  );
  const qtyTolerance = Math.max(EPSILON, executedQty * EPSILON);
  const quoteTolerance = Math.max(0.00000001, cumulativeQuote * EPSILON);
  const fillsComplete =
    Math.abs(fillsQty - executedQty) <= qtyTolerance &&
    Math.abs(fillsQuote - cumulativeQuote) <= quoteTolerance;

  let status: ExecutionStatus;
  if (!fillsComplete) {
    status = "reconcile-required";
  } else {
    switch (order.status) {
      case "NEW":
        status = executedQty > 0 ? "partially-filled" : "submitting";
        break;
      case "PARTIALLY_FILLED":
        status = "partially-filled";
        break;
      case "FILLED":
        status = Math.abs(executedQty - originalQty) <= qtyTolerance ? "filled" : "reconcile-required";
        break;
      case "CANCELED":
      case "EXPIRED":
        status = executedQty > 0 ? "partially-filled" : "cancelled";
        break;
      case "REJECTED":
        status = "rejected";
        break;
      default:
        status = "reconcile-required";
    }
  }

  if (executedQty + qtyTolerance < current.executedQty ||
      cumulativeQuote + quoteTolerance < current.cumulativeQuote) {
    status = "reconcile-required";
  }

  const execution: ExecutionRecord = {
    ...current,
    executedQty: Math.max(current.executedQty, executedQty),
    cumulativeQuote: Math.max(current.cumulativeQuote, cumulativeQuote),
    status,
    updatedAt: Math.max(current.updatedAt, order.updateTime),
  };

  const trades: StoredTrade[] = matched.map((trade) => ({
    id: `${trade.symbol}-${trade.id}`,
    symbol: trade.symbol,
    side: trade.isBuyer ? "BUY" : "SELL",
    time: trade.time,
    price: trade.price,
    qty: trade.qty,
    quoteQty: trade.quoteQty,
    commission: trade.commission,
    commissionAsset: trade.commissionAsset,
    orderId: String(trade.orderId),
    eventKey: current.eventKey,
  }));

  const actualUsdtSpent = cumulativeQuote + quoteCommissionUsdt;
  const remainingQuoteUsdt = current.side === "BUY"
    ? Math.max(0, input.plannedQuoteUsdt - actualUsdtSpent)
    : 0;

  return {
    execution,
    trades,
    fillsComplete,
    remainingQuoteUsdt,
    quoteCommissionUsdt,
    ...(!fillsComplete ? { note: "订单累计成交与成交明细不一致，暂停队列续买和成交邮件，等待补齐成交记录。" } : {}),
    ...(status === "reconcile-required" && fillsComplete
      ? { note: "订单状态或累计值存在冲突，禁止自动重试，需人工/后续对账确认。" }
      : {}),
  };
}
