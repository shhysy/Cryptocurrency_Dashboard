import { describe, expect, it } from "vitest";
import { reconcileSpotOrder } from "./reconciliation";
import type { BinanceSpotOrderSnapshot, BinanceSpotTrade } from "../binance.browser";
import type { ExecutionRecord } from "./execution-core";

const current: ExecutionRecord = {
  eventKey: "evt-btc-head",
  clientOrderId: "lt-btc-head-2026w47",
  symbol: "BTCUSDT",
  side: "BUY",
  status: "submitting",
  requestedQty: 0.01,
  executedQty: 0,
  cumulativeQuote: 0,
  updatedAt: 100,
};

const order: BinanceSpotOrderSnapshot = {
  symbol: "BTCUSDT",
  orderId: 123,
  clientOrderId: current.clientOrderId,
  status: "PARTIALLY_FILLED",
  origQty: "0.01",
  executedQty: "0.004",
  cummulativeQuoteQty: "200",
  time: 100,
  updateTime: 200,
};

const trades: BinanceSpotTrade[] = [{
  id: 9,
  orderId: 123,
  symbol: "BTCUSDT",
  price: 50000,
  qty: 0.004,
  quoteQty: 200,
  commission: 0.2,
  commissionAsset: "USDT",
  time: 180,
  isBuyer: true,
}];

describe("Binance spot order reconciliation", () => {
  it("uses actual partial fills and leaves the unspent plan queued", () => {
    const result = reconcileSpotOrder({
      current, order, trades, plannedQuoteUsdt: 300, quoteAsset: "USDT",
    });
    expect(result.fillsComplete).toBe(true);
    expect(result.execution.status).toBe("partially-filled");
    expect(result.execution.executedQty).toBe(0.004);
    expect(result.remainingQuoteUsdt).toBeCloseTo(99.8);
    expect(result.trades[0].id).toBe("BTCUSDT-9");
  });

  it("does not treat an incomplete trade list as a confirmed fill", () => {
    const result = reconcileSpotOrder({
      current, order, trades: [], plannedQuoteUsdt: 300, quoteAsset: "USDT",
    });
    expect(result.fillsComplete).toBe(false);
    expect(result.execution.status).toBe("reconcile-required");
    expect(result.note).toContain("暂停队列续买");
  });

  it("recognizes a cancelled order with partial fills without losing those fills", () => {
    const result = reconcileSpotOrder({
      current, order: { ...order, status: "CANCELED" }, trades,
      plannedQuoteUsdt: 300, quoteAsset: "USDT",
    });
    expect(result.execution.status).toBe("partially-filled");
    expect(result.remainingQuoteUsdt).toBeCloseTo(99.8);
  });

  it("does not allow an older exchange snapshot to roll back local totals", () => {
    const result = reconcileSpotOrder({
      current: { ...current, executedQty: 0.005, cumulativeQuote: 250, updatedAt: 250 },
      order, trades, plannedQuoteUsdt: 300, quoteAsset: "USDT",
    });
    expect(result.execution.executedQty).toBe(0.005);
    expect(result.execution.cumulativeQuote).toBe(250);
    expect(result.execution.status).toBe("reconcile-required");
  });

  it("rejects an order belonging to a different local execution", () => {
    expect(() => reconcileSpotOrder({
      current, order: { ...order, clientOrderId: "unexpected" }, trades,
      plannedQuoteUsdt: 300, quoteAsset: "USDT",
    })).toThrow("订单快照与本地执行记录不匹配");
  });
});
