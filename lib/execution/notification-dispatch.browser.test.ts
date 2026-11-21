import { beforeEach, describe, expect, it, vi } from "vitest";

const claimTradeNotificationOutboxBatch = vi.fn();
const markTradeNotificationSent = vi.fn();
const markTradeNotificationFailed = vi.fn();

vi.mock("./store.browser", () => ({
  claimTradeNotificationOutboxBatch: (...args: unknown[]) => claimTradeNotificationOutboxBatch(...args),
  markTradeNotificationSent: (...args: unknown[]) => markTradeNotificationSent(...args),
  markTradeNotificationFailed: (...args: unknown[]) => markTradeNotificationFailed(...args),
}));

import { dispatchPendingTradeNotifications } from "./notification-dispatch.browser";

describe("dispatchPendingTradeNotifications 开关与失败路径", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("默认关闭：不 claim、不 fetch", async () => {
    vi.stubEnv("NEXT_PUBLIC_TRADE_FILL_DISPATCH_ENABLED", "");
    const result = await dispatchPendingTradeNotifications();
    expect(result.claimed).toBe(0);
    expect(result.reason).toContain("关闭");
    expect(claimTradeNotificationOutboxBatch).not.toHaveBeenCalled();
  });

  it("开启后服务端返回不完整 accepted 时整批记失败", async () => {
    vi.stubEnv("NEXT_PUBLIC_TRADE_FILL_DISPATCH_ENABLED", "1");
    claimTradeNotificationOutboxBatch.mockResolvedValue([{
      id: "trade-fill:BTCUSDT:1",
      type: "confirmed_trade_fill",
      side: "SELL",
      symbol: "BTCUSDT",
      fillId: "1",
      exchangeOrderId: "9",
      filledQty: 0.1,
      fillPrice: 1,
      quoteQty: 1,
      commission: 0,
      commissionAsset: "USDT",
      commissionUsdt: 0,
      filledAt: 1,
      status: "sending",
      leaseUntil: Date.now() + 60_000,
      leaseToken: "tok",
      nextAttemptAt: null,
      attemptCount: 0,
      createdAt: 1,
      updatedAt: 1,
      lastError: null,
      sentAt: null,
    }]);
    markTradeNotificationFailed.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, accepted: 0, duplicate: 0 }),
    })));
    const result = await dispatchPendingTradeNotifications();
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    expect(markTradeNotificationFailed).toHaveBeenCalled();
  });
});
