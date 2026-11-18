export type ExchangeOrderStatus = "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED" | "UNKNOWN";

export interface ExchangeOrderSnapshot {
  status: ExchangeOrderStatus;
  executedQty: number;
  cummulativeQuoteQty: number;
  orderId: number | string | null;
}

export type ReconcileDecision =
  | { action: "wait"; reason: string }
  | { action: "complete"; executedQty: number; quoteQty: number }
  | { action: "apply_partial_then_wait"; executedQty: number; quoteQty: number }
  | { action: "safe_to_retry"; reason: string }
  | { action: "manual_review"; reason: string };

/** Never resubmit while Binance may still have an open or partially-filled order. */
export function decideOrderReconciliation(snapshot: ExchangeOrderSnapshot | null): ReconcileDecision {
  if (!snapshot) return { action: "manual_review", reason: "按客户端订单 ID 未查到订单；先核对时间窗口和交易记录，不自动重发" };
  if (![snapshot.executedQty, snapshot.cummulativeQuoteQty].every(Number.isFinite)
    || snapshot.executedQty < 0 || snapshot.cummulativeQuoteQty < 0) {
    return { action: "manual_review", reason: "交易所订单成交字段无效" };
  }
  switch (snapshot.status) {
    case "NEW":
      return snapshot.executedQty === 0 && snapshot.cummulativeQuoteQty === 0
        ? { action: "wait", reason: "订单仍在交易所挂起" }
        : { action: "manual_review", reason: "NEW 订单却包含成交累计值，状态数据冲突" };
    case "PARTIALLY_FILLED":
      return snapshot.executedQty > 0 && snapshot.cummulativeQuoteQty > 0
        ? { action: "apply_partial_then_wait", executedQty: snapshot.executedQty, quoteQty: snapshot.cummulativeQuoteQty }
        : { action: "manual_review", reason: "PARTIALLY_FILLED 订单缺少有效成交累计值" };
    case "FILLED":
      return snapshot.executedQty > 0 && snapshot.orderId !== null
        ? { action: "complete", executedQty: snapshot.executedQty, quoteQty: snapshot.cummulativeQuoteQty }
        : { action: "manual_review", reason: "FILLED 订单缺少有效成交数量或订单 ID" };
    case "CANCELED":
    case "EXPIRED":
      return snapshot.executedQty > 0 && snapshot.cummulativeQuoteQty > 0
        ? { action: "apply_partial_then_wait", executedQty: snapshot.executedQty, quoteQty: snapshot.cummulativeQuoteQty }
        : snapshot.executedQty === 0 && snapshot.cummulativeQuoteQty === 0
          ? { action: "safe_to_retry", reason: `订单已${snapshot.status}且零成交；使用新的 attempt ID 才可重试` }
          : { action: "manual_review", reason: "已取消订单的成交累计值互相矛盾" };
    case "REJECTED":
      return snapshot.executedQty > 0 && snapshot.cummulativeQuoteQty > 0
        ? { action: "apply_partial_then_wait", executedQty: snapshot.executedQty, quoteQty: snapshot.cummulativeQuoteQty }
        : { action: "manual_review", reason: "订单被拒绝或成交累计值无效；先处理拒绝原因，不自动重试" };
    default:
      return { action: "manual_review", reason: "未知订单状态" };
  }
}
