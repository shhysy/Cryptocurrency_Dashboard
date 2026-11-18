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
      return { action: "wait", reason: "订单仍在交易所挂起" };
    case "PARTIALLY_FILLED":
      return { action: "apply_partial_then_wait", executedQty: snapshot.executedQty, quoteQty: snapshot.cummulativeQuoteQty };
    case "FILLED":
      return snapshot.executedQty > 0 && snapshot.orderId !== null
        ? { action: "complete", executedQty: snapshot.executedQty, quoteQty: snapshot.cummulativeQuoteQty }
        : { action: "manual_review", reason: "FILLED 订单缺少有效成交数量或订单 ID" };
    case "CANCELED":
    case "EXPIRED":
      return snapshot.executedQty > 0
        ? { action: "apply_partial_then_wait", executedQty: snapshot.executedQty, quoteQty: snapshot.cummulativeQuoteQty }
        : { action: "safe_to_retry", reason: `订单已${snapshot.status}且零成交；使用新的 attempt ID 才可重试` };
    case "REJECTED":
      return snapshot.executedQty > 0
        ? { action: "apply_partial_then_wait", executedQty: snapshot.executedQty, quoteQty: snapshot.cummulativeQuoteQty }
        : { action: "manual_review", reason: "订单被拒绝；先处理拒绝原因，不自动重试" };
    default:
      return { action: "manual_review", reason: "未知订单状态" };
  }
}
