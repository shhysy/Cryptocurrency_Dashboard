import {
  claimTradeNotificationOutboxBatch,
  markTradeNotificationFailed,
  markTradeNotificationSent,
} from "./store.browser";
import type { TradeNotificationOutboxEvent } from "./notification-outbox";

function assertDispatchableEvent(event: TradeNotificationOutboxEvent): void {
  if (event.type !== "confirmed_trade_fill") throw new Error("仅投递已确认成交事件");
  if (!event.id || !event.fillId || !event.symbol || !event.exchangeOrderId) {
    throw new Error("成交通知事件缺少标识字段");
  }
  if (event.side !== "BUY" && event.side !== "SELL") throw new Error("成交通知方向无效");
  if (!(event.filledQty > 0) || !(event.fillPrice > 0) || !(event.quoteQty > 0)) {
    throw new Error("成交通知数量或价格无效");
  }
  if (event.status !== "sending" || !event.leaseToken) {
    throw new Error("成交通知必须在持有租约的 sending 状态下投递");
  }
}

function workerEvent(event: TradeNotificationOutboxEvent) {
  return {
    id: event.id,
    type: event.type,
    side: event.side,
    symbol: event.symbol,
    fillId: event.fillId,
    exchangeOrderId: event.exchangeOrderId,
    filledQty: event.filledQty,
    fillPrice: event.fillPrice,
    quoteQty: event.quoteQty,
    commission: event.commission,
    commissionAsset: event.commissionAsset,
    commissionUsdt: event.commissionUsdt,
    filledAt: event.filledAt,
  };
}

/**
 * Deliver only events already created by the exchange-fill reconciliation
 * transaction. The same-origin API verifies Cloudflare Access and signs the
 * request server-side; the browser never handles the HMAC secret.
 */
export async function dispatchPendingTradeNotifications(): Promise<{
  claimed: number;
  sent: number;
  failed: number;
  reason: string | null;
}> {
  const batch = await claimTradeNotificationOutboxBatch(20);
  if (batch.length === 0) return { claimed: 0, sent: 0, failed: 0, reason: null };

  let failure: string | null = null;
  try {
    for (const event of batch) assertDispatchableEvent(event);
    const response = await fetch("/api/trade-fill-notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch.map(workerEvent) }),
      cache: "no-store",
      credentials: "same-origin",
    });
    const result = await response.json().catch(() => null) as {
      ok?: boolean; accepted?: number; duplicate?: number; error?: string;
    } | null;
    if (!response.ok || result?.ok !== true ||
        !Number.isInteger(result.accepted) || !Number.isInteger(result.duplicate) ||
        result.accepted! + result.duplicate! !== batch.length) {
      throw new Error(result?.error ?? `成交通知服务返回 HTTP ${response.status}`);
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : "成交通知投递失败";
  }

  if (failure) {
    // A lease may have expired while the request was in flight. In that case
    // the fencing check intentionally rejects this stale worker's update.
    const updates = await Promise.allSettled(batch.map((event) =>
      markTradeNotificationFailed(event.id, event.leaseToken ?? "", failure!),
    ));
    const failed = updates.filter((item) => item.status === "fulfilled").length;
    return {
      claimed: batch.length,
      sent: 0,
      failed,
      reason: failure,
    };
  }

  const updates = await Promise.allSettled(batch.map((event) =>
    markTradeNotificationSent(event.id, event.leaseToken ?? ""),
  ));
  const sent = updates.filter((item) => item.status === "fulfilled").length;
  return { claimed: batch.length, sent, failed: 0, reason: null };
}
