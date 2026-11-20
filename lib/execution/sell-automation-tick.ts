import type { DashboardData } from "../types";
import { BINANCE_SPOT_SELL_SUBMISSION_ENABLED } from "../binance.browser";
import { enqueueEligibleSellSignals } from "./sell-signal-queue";
import { listSellEvents } from "./sell-store.browser";
import { submitQueuedSellEvent } from "./sell-order-submit.browser";
import { syncSellOrderFromBinance } from "./sync-sell-order.browser";
import { dispatchPendingTradeNotifications } from "./notification-dispatch.browser";

export interface SellAutomationTickResult {
  enqueued: number;
  enqueueBlocked: number;
  synced: number;
  submitted: number;
  notificationsSent: number;
  notificationsFailed: number;
  /** 本轮是否因开关/数据新鲜度而跳过真实提交 */
  liveSubmitSkippedReason: string | null;
  errors: string[];
}

export interface SellAutomationTickOptions {
  /**
   * 是否允许尝试真实卖出提交。
   * 仍受编译期 BINANCE_SPOT_SELL_SUBMISSION_ENABLED 约束；两者都为真才会 POST。
   */
  attemptLiveSubmit?: boolean;
  /** 看板快照最大允许年龄（毫秒），默认 120s */
  maxDataAgeMs?: number;
  now?: number;
}

/**
 * 卖出自动化单次节拍（可被后台定时器或测试调用）：
 * 1) 从看板信号入队卖出意图
 * 2) 对需对账事件只读同步交易所
 * 3) 在双开关与数据新鲜时最多尝试一笔 pending 卖出
 * 4) 派发已确认成交的通知 Outbox
 *
 * 不开启实盘时，步骤 3 会安全跳过；绝不会绕过 submitQueuedSellEvent 内的 LIVE 检查。
 */
export async function runSellAutomationTick(
  data: DashboardData,
  options: SellAutomationTickOptions = {},
): Promise<SellAutomationTickResult> {
  const now = options.now ?? Date.now();
  const maxAge = options.maxDataAgeMs ?? 120_000;
  const errors: string[] = [];
  let enqueued = 0;
  let enqueueBlocked = 0;
  let synced = 0;
  let submitted = 0;
  let notificationsSent = 0;
  let notificationsFailed = 0;
  let liveSubmitSkippedReason: string | null = null;

  try {
    const plan = await enqueueEligibleSellSignals(data);
    enqueued = plan.created;
    enqueueBlocked = plan.blocked.length;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "卖出信号入队失败");
  }

  try {
    const events = await listSellEvents();
    for (const event of events) {
      if (event.status !== "reconcile_required" && event.status !== "partially_filled") continue;
      if (!event.clientOrderId && !event.exchangeOrderId) continue;
      try {
        await syncSellOrderFromBinance(event.eventKey);
        synced += 1;
      } catch (error) {
        errors.push(
          `${event.eventKey}: ${error instanceof Error ? error.message : "卖出对账失败"}`,
        );
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "列出卖出事件失败");
  }

  const dataAgeMs = now - data.updatedAt;
  const dataFresh = dataAgeMs >= 0 && dataAgeMs <= maxAge;
  const canAttempt =
    options.attemptLiveSubmit === true &&
    BINANCE_SPOT_SELL_SUBMISSION_ENABLED &&
    data.source === "binance" &&
    !data.stale &&
    data.market.accountKnown &&
    dataFresh;

  if (!canAttempt) {
    if (options.attemptLiveSubmit !== true) {
      liveSubmitSkippedReason = "本节拍未请求尝试实盘提交（attemptLiveSubmit≠true）";
    } else if (!BINANCE_SPOT_SELL_SUBMISSION_ENABLED) {
      liveSubmitSkippedReason = "BINANCE_SPOT_SELL_SUBMISSION_ENABLED 未开启";
    } else if (data.source !== "binance" || data.stale || !data.market.accountKnown) {
      liveSubmitSkippedReason = "数据源非币安、已过期标记或账户未知";
    } else if (!dataFresh) {
      liveSubmitSkippedReason = "看板快照超过允许年龄，禁止新卖出";
    } else {
      liveSubmitSkippedReason = "不满足卖出提交条件";
    }
  } else {
    try {
      const queued = await listSellEvents();
      const event = queued.find((item) =>
        item.status === "pending" &&
        ["take_profit", "indicator_profit", "trail_stop", "base_reduce"].includes(item.kind),
      );
      if (event) {
        await submitQueuedSellEvent(event.eventKey);
        submitted = 1;
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "卖出提交失败");
    }
  }

  try {
    const notifications = await dispatchPendingTradeNotifications();
    notificationsSent = notifications.sent;
    notificationsFailed = notifications.failed;
    if (notifications.reason && notifications.failed > 0) {
      errors.push(notifications.reason);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "成交通知派发失败");
  }

  return {
    enqueued,
    enqueueBlocked,
    synced,
    submitted,
    notificationsSent,
    notificationsFailed,
    liveSubmitSkippedReason,
    errors,
  };
}
