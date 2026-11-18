import { describe, expect, it } from "vitest";
import { buildTradeFillNotificationEvent, isTradeNotificationClaimable } from "./notification-outbox";
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

describe("trade fill notification outbox", () => {
  it("builds a stable event from an exchange-confirmed fill", () => {
    expect(buildTradeFillNotificationEvent(fill, 42)).toEqual({
      id: "trade-fill:BTCUSDT:987654",
      type: "confirmed_trade_fill",
      side: "BUY",
      symbol: "BTCUSDT",
      fillId: "987654",
      exchangeOrderId: "123456",
      filledQty: 0.001,
      fillPrice: 65000,
      quoteQty: 65,
      commission: 0.000001,
      commissionAsset: "BTC",
      commissionUsdt: 0.065,
      filledAt: 1_800_000_000_000,
      status: "pending",
      leaseUntil: null,
      nextAttemptAt: null,
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
    expect(isTradeNotificationClaimable({ status: "sending", leaseUntil: 200 }, 200)).toBe(true);
    expect(isTradeNotificationClaimable({ status: "sending", leaseUntil: null, nextAttemptAt: null }, 100)).toBe(true);
  });

  it("never reclaims sent events or accepts invalid clocks", () => {
    expect(isTradeNotificationClaimable({ status: "sent", leaseUntil: null, nextAttemptAt: null }, 100)).toBe(false);
    expect(isTradeNotificationClaimable({ status: "pending", leaseUntil: null }, Number.NaN)).toBe(false);
  });
});


  it("honors exponential retry backoff for failed events", () => {
    expect(isTradeNotificationClaimable({
      status: "failed", leaseUntil: null, nextAttemptAt: 500,
    }, 499)).toBe(false);
    expect(isTradeNotificationClaimable({
      status: "failed", leaseUntil: null, nextAttemptAt: 500,
    }, 500)).toBe(true);
  });
