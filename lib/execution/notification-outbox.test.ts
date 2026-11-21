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
    expect(buildTradeFillNotificationEvent(fill, 100).status).toBe("pending");
    expect(buildTradeFillNotificationEvent(fill, 100).id).toBe("trade-fill:BTCUSDT:987654");
  });

  it("uses a deterministic id so retries do not create duplicate events", () => {
    expect(buildTradeFillNotificationEvent(fill, 1).id).toBe(buildTradeFillNotificationEvent(fill, 2).id);
  });

  it("only pending or expired leases are claimable", () => {
    expect(isTradeNotificationClaimable({ status: "pending", leaseUntil: null, nextAttemptAt: null }, 100)).toBe(true);
    expect(isTradeNotificationClaimable({ status: "sending", leaseUntil: 200, nextAttemptAt: null }, 199)).toBe(false);
    expect(isTradeNotificationClaimable({ status: "sending", leaseUntil: 200, nextAttemptAt: null }, 200)).toBe(true);
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

describe("GROK-SELL-06 Outbox 边界", () => {
  const sellFill: ExecutionFill = {
    fillId: "987654",
    orderId: "123456",
    symbol: "BTCUSDT",
    side: "SELL",
    time: 1_800_000_000_000,
    price: 65000,
    qty: 0.001,
    quoteQty: 65,
    commission: 0.000001,
    commissionAsset: "BTC",
    commissionUsdt: 0.065,
  };

  it("leaseUntil=null 的 sending 视为租约失效，可被恢复领取", () => {
    const base = buildTradeFillNotificationEvent(sellFill, 1000);
    const stuck = { ...base, status: "sending" as const, leaseUntil: null, leaseToken: "dead" };
    expect(isTradeNotificationClaimable(stuck, 2000)).toBe(true);
    const recovered = applyTradeNotificationLeaseClaim(stuck, 2000, "alive", 60_000);
    expect(recovered.leaseToken).toBe("alive");
    expect(() => applyTradeNotificationSent(recovered, "dead", 2001)).toThrow(/令牌/);
  });

  it("已 sent 事件拒绝任何后续 sent/failed 写回（旧调度器迟到回执）", () => {
    const base = buildTradeFillNotificationEvent(sellFill, 1000);
    const claimed = applyTradeNotificationLeaseClaim(base, 1000, "t1", 60_000);
    const sent = applyTradeNotificationSent(claimed, "t1", 1500);
    expect(() => applyTradeNotificationSent(sent, "t1", 1600)).toThrow();
    expect(() => applyTradeNotificationFailed(sent, "t1", "late", 1600)).toThrow();
    expect(isTradeNotificationClaimable(sent, 9999)).toBe(false);
  });

  it("空 leaseToken 不可领取", () => {
    const base = buildTradeFillNotificationEvent(sellFill, 1000);
    expect(() => applyTradeNotificationLeaseClaim(base, 1000, "", 60_000)).toThrow();
  });
});
