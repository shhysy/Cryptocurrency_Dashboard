import {
  claimTradeNotificationOutboxBatch,
  markTradeNotificationFailed,
  markTradeNotificationSent,
} from "./store.browser";
import type { TradeNotificationOutboxEvent } from "./notification-outbox";

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

  try {
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
    await Promise.all(batch.map((event) => markTradeNotificationSent(event.id)));
    return { claimed: batch.length, sent: batch.length, failed: 0, reason: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "成交通知投递失败";
    await Promise.all(batch.map((event) => markTradeNotificationFailed(event.id, reason)));
    return { claimed: batch.length, sent: 0, failed: batch.length, reason };
  }
}
