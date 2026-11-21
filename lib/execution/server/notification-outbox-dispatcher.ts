import { dispatchTradeFillMail, isTradeFillMailEnabled } from "./trade-fill-mail.server";
import type { LocalExecutionStore } from "./store";

export interface NotificationOutboxCycleResult {
  claimed: number;
  sent: number;
  failed: number;
  skipped: boolean;
}

/** 本地Trader Outbox投递：SQLite租约防并发、指数退避、失败达到10次转人工复核。 */
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
  if (!isTradeFillMailEnabled()) {
    result.skipped = true;
    return result;
  }

  const leases = await store.notificationOutbox.claimDue({
    now,
    leaseMs: 30_000,
    limit: 10,
  });
  result.claimed = leases.length;

  for (const lease of leases) {
    const event = lease.event;
    try {
      const sent = await dispatchTradeFillMail([{
        id: event.id,
        type: event.type,
        side: event.side,
        symbol: event.symbol,
        filledQty: event.filledQty,
        fillPrice: event.fillPrice,
      }]);
      if (sent.ok && sent.sent) {
        const marked = await store.notificationOutbox.markSent({
          id: event.id,
          leaseToken: lease.leaseToken,
          now: Date.now(),
        });
        if (marked) result.sent += 1;
        else result.failed += 1;
      } else {
        const reason = sent.reason ?? "SMTP未确认发送成功";
        const state = await store.notificationOutbox.markFailed({
          id: event.id,
          leaseToken: lease.leaseToken,
          now: Date.now(),
          reason,
        });
        if (state === "lease_lost") result.failed += 1;
        else result.failed += 1;
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
