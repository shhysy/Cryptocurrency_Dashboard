import { describe, expect, it } from "vitest";
import {
  applyTradeNotificationFailed,
  applyTradeNotificationLeaseClaim,
  applyTradeNotificationSent,
  buildTradeFillNotificationEvent,
  isTradeNotificationClaimable,
  tradeNotificationRetryDelayMs,
} from "./notification-outbox";
import type { ExecutionFill } from "./types";

const fill: ExecutionFill = {
  fillId: "987654",
  orderId: "123456",
  symbol: "BTCUSDT",
  side: "BUY",
  time: 1_800_000_000_000,
  price: 65000,
  qty: 0.001,
  quoteQty: 65,
  commission: 0.000001,
  commissionAsset: "BTC",
  commissionUsdt: 0.065,
};

describe("trade fill notification outbox events", () => {
  it("builds a pending event from a confirmed exchange fill", () => {
    expect(buildTradeFillNotificationEvent(fill, 42)).toMatchObject({
      id: "trade-fill:BTCUSDT:987654",
      type: "confirmed_trade_fill",
      side: "BUY",
      symbol: "BTCUSDT",
      fillId: "987654",
      exchangeOrderId: "123456",
      status: "pending",
      leaseToken: null,
      attemptCount: 0,
      createdAt: 42,
      updatedAt: 42,
      lastError: null,
      sentAt: null,
    });
  });

  it("uses the same id for the same exchange fill across retries", () => {
    expect(buildTradeFillNotificationEvent(fill, 42).id)
      .toBe(buildTradeFillNotificationEvent(fill, 99).id);
  });

  it("rejects invalid or incomplete fill facts", () => {
    expect(() => buildTradeFillNotificationEvent({ ...fill, qty: 0 })).toThrow();
    expect(() => buildTradeFillNotificationEvent({ ...fill, price: Number.NaN })).toThrow();
    expect(() => buildTradeFillNotificationEvent({ ...fill, fillId: "" })).toThrow();
  });
});

describe("confirmed SELL fill notification", () => {
  it("creates a SELL event from an exchange-confirmed sell fill", () => {
    const sellFill: ExecutionFill = { ...fill, side: "SELL", fillId: "9001" };
    const event = buildTradeFillNotificationEvent(sellFill, 123);
    expect(event.side).toBe("SELL");
    expect(event.id).toBe("trade-fill:BTCUSDT:9001");
    expect(event.type).toBe("confirmed_trade_fill");
  });
});

describe("trade notification delivery lease", () => {
  it("claims pending and failed events", () => {
    expect(isTradeNotificationClaimable({ status: "pending", leaseUntil: null, nextAttemptAt: null }, 100)).toBe(true);
    expect(isTradeNotificationClaimable({ status: "failed", leaseUntil: null, nextAttemptAt: null }, 100)).toBe(true);
  });

  it("does not claim a sending event before its lease expires", () => {
    expect(isTradeNotificationClaimable({ status: "sending", leaseUntil: 200, nextAttemptAt: null }, 199)).toBe(false);
    expect(isTradeNotificationClaimable({ status: "sending", leaseUntil: 200, nextAttemptAt: null }, 200)).toBe(true);
    expect(isTradeNotificationClaimable({ status: "sending", leaseUntil: null, nextAttemptAt: null }, 100)).toBe(true);
  });

  it("never reclaims sent events or accepts invalid clocks", () => {
    expect(isTradeNotificationClaimable({ status: "sent", leaseUntil: null, nextAttemptAt: null }, 100)).toBe(false);
    expect(isTradeNotificationClaimable({ status: "pending", leaseUntil: null, nextAttemptAt: null }, Number.NaN)).toBe(false);
  });
  it("honors exponential retry backoff for failed events", () => {
    expect(isTradeNotificationClaimable({
      status: "failed", leaseUntil: null, nextAttemptAt: 500,
    }, 499)).toBe(false);
    expect(isTradeNotificationClaimable({
      status: "failed", leaseUntil: null, nextAttemptAt: 500,
    }, 500)).toBe(true);
  });
});

describe("成交通知租约与退避（纯函数）", () => {
  const base = buildTradeFillNotificationEvent(fill, 1000);

  it("退避上限为 1 小时，并随 attempt 指数增长", () => {
    expect(tradeNotificationRetryDelayMs(0)).toBe(30_000);
    expect(tradeNotificationRetryDelayMs(1)).toBe(60_000);
    expect(tradeNotificationRetryDelayMs(7)).toBe(60 * 60_000);
    expect(tradeNotificationRetryDelayMs(99)).toBe(60 * 60_000);
  });

  it("领取租约后状态为 sending 且带有 fence 令牌", () => {
    const claimed = applyTradeNotificationLeaseClaim(base, 1000, "token-a", 60_000);
    expect(claimed.status).toBe("sending");
    expect(claimed.leaseToken).toBe("token-a");
    expect(claimed.leaseUntil).toBe(61_000);
  });

  it("租约未过期的 sending 不可再次领取", () => {
    const claimed = applyTradeNotificationLeaseClaim(base, 1000, "token-a", 60_000);
    expect(isTradeNotificationClaimable(claimed, 60_999)).toBe(false);
    expect(isTradeNotificationClaimable(claimed, 61_000)).toBe(true);
  });

  it("过期后可被新令牌领取；旧令牌无法标记 sent/failed", () => {
    const claimed = applyTradeNotificationLeaseClaim(base, 1000, "token-old", 1);
    const reclaimed = applyTradeNotificationLeaseClaim(claimed, 2000, "token-new", 60_000);
    expect(reclaimed.leaseToken).toBe("token-new");
    expect(() => applyTradeNotificationSent(reclaimed, "token-old", 2001)).toThrow(/令牌/);
    expect(() => applyTradeNotificationFailed(reclaimed, "token-old", "x", 2001)).toThrow(/令牌/);
    const sent = applyTradeNotificationSent(reclaimed, "token-new", 2001);
    expect(sent.status).toBe("sent");
    expect(sent.leaseToken).toBeNull();
    expect(isTradeNotificationClaimable(sent, 3000)).toBe(false);
  });

  it("失败后写入 nextAttemptAt，在退避结束前不可领取", () => {
    const claimed = applyTradeNotificationLeaseClaim(base, 1000, "t1", 60_000);
    const failed = applyTradeNotificationFailed(claimed, "t1", "网络错误", 1000);
    expect(failed.status).toBe("failed");
    expect(failed.attemptCount).toBe(1);
    expect(failed.nextAttemptAt).toBe(1000 + tradeNotificationRetryDelayMs(1));
    expect(isTradeNotificationClaimable(failed, failed.nextAttemptAt! - 1)).toBe(false);
    expect(isTradeNotificationClaimable(failed, failed.nextAttemptAt!)).toBe(true);
  });
});

describe("成交通知仅接受已确认成交事实", () => {
  it("缺少 orderId/fillId 不得构造已成交通知", () => {
    expect(() => buildTradeFillNotificationEvent({ ...fill, orderId: "" })).toThrow();
    expect(() => buildTradeFillNotificationEvent({ ...fill, fillId: "" })).toThrow();
  });

  it("commissionUsdt 为负数时拒绝", () => {
    expect(() => buildTradeFillNotificationEvent({ ...fill, commissionUsdt: -0.01 })).toThrow();
  });
});
