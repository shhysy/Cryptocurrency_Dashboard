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
  /** Fencing token: stale dispatchers cannot complete a lease reclaimed by another tab. */
  leaseToken: string | null;
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
    leaseToken: null,
    nextAttemptAt: null,
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
    lastError: null,
    sentAt: null,
  };
}

/** 失败重试退避（毫秒）：与 store 中 markFailed 公式一致，便于单测 */
export function tradeNotificationRetryDelayMs(attemptCount: number): number {
  const n = Number.isFinite(attemptCount) ? Math.max(0, Math.floor(attemptCount)) : 0;
  return Math.min(60 * 60_000, 30_000 * (2 ** Math.min(n, 7)));
}

const DEFAULT_LEASE_MS = 60_000;

/**
 * 纯函数：领取租约后的事件状态（不写库）。
 * 仅当 isTradeNotificationClaimable 为真时调用。
 */
export function applyTradeNotificationLeaseClaim(
  event: TradeNotificationOutboxEvent,
  now: number,
  leaseToken: string,
  leaseMs = DEFAULT_LEASE_MS,
): TradeNotificationOutboxEvent {
  if (!isTradeNotificationClaimable(event, now)) {
    throw new Error("成交通知事件当前不可领取");
  }
  if (!leaseToken || typeof leaseToken !== "string") {
    throw new Error("成交通知租约令牌无效");
  }
  if (!Number.isSafeInteger(now) || now <= 0 || !Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new Error("成交通知租约时间参数无效");
  }
  return {
    ...event,
    status: "sending",
    leaseUntil: now + leaseMs,
    leaseToken,
    updatedAt: now,
    lastError: null,
  };
}

/**
 * 纯函数：租约令牌匹配时标记已发送。令牌不匹配则抛错（模拟围栏拒绝）。
 */
export function applyTradeNotificationSent(
  event: TradeNotificationOutboxEvent,
  leaseToken: string,
  now: number,
): TradeNotificationOutboxEvent {
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error("时间戳无效");
  if (event.status !== "sending" || event.leaseToken !== leaseToken) {
    throw new Error("成交通知租约令牌不匹配或状态不是 sending，拒绝标记已发送");
  }
  return {
    ...event,
    status: "sent",
    leaseUntil: null,
    leaseToken: null,
    nextAttemptAt: null,
    sentAt: now,
    updatedAt: now,
    lastError: null,
  };
}

/**
 * 纯函数：租约匹配时标记失败并设置指数退避。
 */
export function applyTradeNotificationFailed(
  event: TradeNotificationOutboxEvent,
  leaseToken: string,
  error: string,
  now: number,
): TradeNotificationOutboxEvent {
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error("时间戳无效");
  if (event.status !== "sending" || event.leaseToken !== leaseToken) {
    throw new Error("成交通知租约令牌不匹配或状态不是 sending，拒绝标记失败");
  }
  const attemptCount = event.attemptCount + 1;
  return {
    ...event,
    status: "failed",
    leaseUntil: null,
    leaseToken: null,
    attemptCount,
    nextAttemptAt: now + tradeNotificationRetryDelayMs(attemptCount),
    updatedAt: now,
    lastError: error || "成交通知投递失败",
  };
}
