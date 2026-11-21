import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalExecutionStore } from "./store";
import type { TradeNotificationOutboxEvent } from "../notification-outbox";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(() => true),
  dispatch: vi.fn(async (): Promise<{ ok: boolean; sent: boolean; reason?: string }> => ({ ok: true, sent: true })),
  alertEnabled: vi.fn(() => false),
  alertDispatch: vi.fn(async (): Promise<{ ok: boolean; sent: boolean; reason?: string }> => ({ ok: true, sent: true })),
}));
vi.mock("./trade-fill-mail.server", () => ({
  isTradeFillMailEnabled: mocks.enabled,
  dispatchTradeFillMail: mocks.dispatch,
  isTraderAlertMailEnabled: mocks.alertEnabled,
  dispatchTraderAlertMail: mocks.alertDispatch,
}));

import { runNotificationOutboxCycle } from "./notification-outbox-dispatcher";

const event: TradeNotificationOutboxEvent = {
  id: "trade-fill:BTCUSDT:1",
  type: "confirmed_trade_fill",
  side: "SELL",
  symbol: "BTCUSDT",
  fillId: "1",
  exchangeOrderId: "100",
  filledQty: 0.1,
  fillPrice: 60_000,
  quoteQty: 6_000,
  commission: 0,
  commissionAsset: "USDT",
  commissionUsdt: 0,
  filledAt: 1_800_000_000_000,
  businessSnapshot: {
    side: "SELL", sellKind: "take_profit", cumulativeFilledQty: "0.1",
    cumulativeQuoteQty: "6000", cumulativeCommissionUsdt: "0",
    averageFillPrice: "60000", realizedPnlUsdt: 123, remainingPositionQty: 0.4,
    accountingAvailable: true,
  },
  status: "sending",
  leaseUntil: 1_800_000_030_000,
  leaseToken: "lease-1",
  nextAttemptAt: null,
  attemptCount: 1,
  createdAt: 1_800_000_000_000,
  updatedAt: 1_800_000_000_000,
  lastError: null,
  sentAt: null,
};

function store() {
  return {
    notificationOutbox: {
      claimDue: vi.fn(async () => [{ event, leaseToken: "lease-1" }]),
      markSent: vi.fn(async () => true),
      markFailed: vi.fn(async () => "pending" as const),
    },
  } as unknown as LocalExecutionStore;
}

afterEach(() => {
  mocks.enabled.mockReset();
  mocks.enabled.mockReturnValue(true);
  mocks.dispatch.mockReset();
  mocks.dispatch.mockResolvedValue({ ok: true, sent: true });
  mocks.alertEnabled.mockReset();
  mocks.alertEnabled.mockReturnValue(false);
  mocks.alertDispatch.mockReset();
  mocks.alertDispatch.mockResolvedValue({ ok: true, sent: true });
});

describe("本地成交Outbox投递器", () => {
  it("发送成功后用相同租约令牌标记sent", async () => {
    const repo = store();
    const result = await runNotificationOutboxCycle(repo, 1_800_000_000_001);
    expect(result).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    expect(mocks.dispatch).toHaveBeenCalledWith([expect.objectContaining({
      id: event.id,
      side: "SELL",
      symbol: "BTCUSDT",
      businessSnapshot: event.businessSnapshot,
    })]);
    expect(repo.notificationOutbox.markSent).toHaveBeenCalledWith(expect.objectContaining({
      id: event.id,
      leaseToken: "lease-1",
    }));
  });

  it("SMTP失败后标记退避重试，不会谎报发送成功", async () => {
    const repo = store();
    mocks.dispatch.mockResolvedValue({ ok: false, sent: false, reason: "SMTP unavailable" });
    const result = await runNotificationOutboxCycle(repo, 1_800_000_000_001);
    expect(result).toMatchObject({ claimed: 1, sent: 0, failed: 1 });
    expect(repo.notificationOutbox.markFailed).toHaveBeenCalledWith(expect.objectContaining({
      id: event.id,
      leaseToken: "lease-1",
      reason: "SMTP unavailable",
    }));
  });


  it("系统告警开关独立启用时只领取并发送系统告警", async () => {
    const repo = store();
    const alert = {
      ...event,
      id: "trader-alert:circuit-breaker:1800000000000",
      type: "system_alert" as const,
      severity: "critical" as const,
      title: "Trader连续故障熔断",
      message: "连续失败达到阈值",
      occurredAt: 1_800_000_000_000,
      side: undefined,
      symbol: undefined,
      fillId: undefined,
      exchangeOrderId: undefined,
    };
    repo.notificationOutbox.claimDue = vi.fn(async () => [{ event: alert, leaseToken: "alert-lease" }]);
    mocks.enabled.mockReturnValue(false);
    mocks.alertEnabled.mockReturnValue(true);
    const result = await runNotificationOutboxCycle(repo, 1_800_000_000_001);
    expect(result).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    expect(repo.notificationOutbox.claimDue).toHaveBeenCalledWith(expect.objectContaining({
      eventTypes: ["system_alert"],
    }));
    expect(mocks.alertDispatch).toHaveBeenCalledWith(expect.objectContaining({
      id: alert.id,
      title: alert.title,
    }));
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("邮件开关关闭时不领取Outbox", async () => {
    const repo = store();
    mocks.enabled.mockReturnValue(false);
    const result = await runNotificationOutboxCycle(repo, 1_800_000_000_001);
    expect(result.skipped).toBe(true);
    expect(repo.notificationOutbox.claimDue).not.toHaveBeenCalled();
  });
});
