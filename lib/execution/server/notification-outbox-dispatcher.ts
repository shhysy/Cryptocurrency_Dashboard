import {
  dispatchTradeFillMail,
  dispatchTraderAlertMail,
  isTradeFillMailEnabled,
  isTraderAlertMailEnabled,
} from "./trade-fill-mail.server";
import type { LocalExecutionStore } from "./store";

export interface NotificationOutboxCycleResult {
  claimed: number;
  sent: number;
  failed: number;
  skipped: boolean;
}

/** 本地Trader Outbox投递：按事件类型启用、SQLite租约防并发、指数退避。 */
export async function runNotificationOutboxCycle(
  store: LocalExecutionStore,
  now = Date.now(),
): Promise<NotificationOutboxCycleResult> {
  const result: NotificationOutboxCycleResult = {
    claimed: 0,
    sent: 0,
    failed: 0,
    skipped: false,
  };
  const eventTypes = [
    ...(isTradeFillMailEnabled() ? ["confirmed_trade_fill" as const] : []),
    ...(isTraderAlertMailEnabled() ? ["system_alert" as const] : []),
  ];
  if (!eventTypes.length) {
    result.skipped = true;
    return result;
  }

  const leases = await store.notificationOutbox.claimDue({
    now,
    leaseMs: 30_000,
    limit: 10,
    eventTypes,
  });
  result.claimed = leases.length;

  for (const lease of leases) {
    const event = lease.event;
    try {
      const sent = event.type === "confirmed_trade_fill"
        ? await dispatchTradeFillMail([{
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
          }])
        : await dispatchTraderAlertMail({
            id: event.id,
            severity: event.severity ?? "critical",
            title: event.title ?? "Trader系统告警",
            message: event.message ?? "告警事件缺少正文，请检查本地日志。",
            occurredAt: event.occurredAt ?? event.createdAt,
          });

      if (sent.ok && sent.sent) {
        const marked = await store.notificationOutbox.markSent({
          id: event.id,
          leaseToken: lease.leaseToken,
          now: Date.now(),
        });
        if (marked) result.sent += 1;
        else result.failed += 1;
      } else {
        await store.notificationOutbox.markFailed({
          id: event.id,
          leaseToken: lease.leaseToken,
          now: Date.now(),
          reason: sent.reason ?? "SMTP未确认发送成功",
        });
        result.failed += 1;
      }
    } catch (error) {
      await store.notificationOutbox.markFailed({
        id: event.id,
        leaseToken: lease.leaseToken,
        now: Date.now(),
        reason: error instanceof Error ? error.message : "SMTP投递失败",
      });
      result.failed += 1;
    }
  }
  return result;
}
