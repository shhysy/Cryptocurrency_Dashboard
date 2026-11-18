import { describe, expect, it } from "vitest";
import { buildTradeFillNotificationEvent } from "./notification-outbox";
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
