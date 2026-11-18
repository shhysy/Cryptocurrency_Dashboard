import type { ExecutionFill } from "./types";

export interface TradeNotificationOutboxEvent {
  id: string;
  type: "confirmed_trade_fill";
  side: "BUY" | "SELL";
  symbol: string;
  fillId: string;
  exchangeOrderId: string;
  filledQty: number;
  fillPrice: number;
  quoteQty: number;
  commission: number;
  commissionAsset: string;
  commissionUsdt: number;
  filledAt: number;
  status: "pending" | "sending" | "sent" | "failed";
  /** Lease prevents two browser tabs from delivering the same event concurrently. */
  leaseUntil: number | null;
  nextAttemptAt: number | null;
  attemptCount: number;
  createdAt: number;
  updatedAt: number;
  lastError: string | null;
  sentAt: number | null;
}

/** Whether an outbox event may be claimed by a dispatcher at the supplied time. */
export function isTradeNotificationClaimable(
  event: Pick<TradeNotificationOutboxEvent, "status" | "leaseUntil" | "nextAttemptAt">,
  now: number,
): boolean {
  if (!Number.isSafeInteger(now) || now <= 0) return false;
  return event.status === "pending" ||
    (event.status === "failed" && (event.nextAttemptAt ?? 0) <= now) ||
    (event.status === "sending" && (event.leaseUntil ?? 0) <= now);
}

/**
 * Build a deterministic notification event only from a validated exchange fill.
 * The event contains execution facts, never API credentials or account balances.
 */
export function buildTradeFillNotificationEvent(
  fill: ExecutionFill,
  now = Date.now(),
): TradeNotificationOutboxEvent {
  if (!fill.fillId || !fill.symbol || !fill.orderId) {
    throw new Error("成交通知缺少交易所成交标识");
  }
  if (fill.side !== "BUY" && fill.side !== "SELL") {
    throw new Error("成交通知方向无效");
  }
  for (const [name, value] of Object.entries({
    qty: fill.qty,
    price: fill.price,
    quoteQty: fill.quoteQty,
    commission: fill.commission,
    commissionUsdt: fill.commissionUsdt,
    time: fill.time,
  })) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`成交通知字段 ${name} 无效`);
    }
  }
  if (fill.qty <= 0 || fill.price <= 0 || fill.quoteQty <= 0) {
    throw new Error("成交通知数量、价格和成交金额必须大于零");
  }
  return {
    id: `trade-fill:${fill.symbol}:${fill.fillId}`,
    type: "confirmed_trade_fill",
    side: fill.side,
    symbol: fill.symbol,
    fillId: fill.fillId,
    exchangeOrderId: fill.orderId,
    filledQty: fill.qty,
    fillPrice: fill.price,
    quoteQty: fill.quoteQty,
    commission: fill.commission,
    commissionAsset: fill.commissionAsset,
    commissionUsdt: fill.commissionUsdt,
    filledAt: fill.time,
    status: "pending",
    leaseUntil: null,
    nextAttemptAt: null,
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
    lastError: null,
    sentAt: null,
  };
}
