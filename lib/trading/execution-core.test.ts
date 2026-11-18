import { describe, expect, it } from "vitest";
import {
  calculateSellableQty,
  canSubmitAgain,
  makeExecutionKey,
  mergeExecutionFill,
  nextStatusAfterSubmit,
  planQuoteBuy,
} from "./execution-core";

const rules = {
  symbol: "BTCUSDT",
  status: "TRADING",
  stepSize: "0.00001",
  minQty: "0.00001",
  minNotional: "5",
};

describe("spot execution planning", () => {
  it("splits a 100 USDT plan into 50 USDT now when only 50 USDT is free", () => {
    const order = planQuoteBuy({
      symbol: "BTCUSDT",
      plannedUsdt: 100,
      freeUsdt: 50,
      remainingAssetCapUsdt: 1000,
      referencePrice: 50000,
      rules,
    });
    expect(order.status).toBe("ready");
    expect(order.quantity).toBe(0.001);
    expect(order.quoteAmount).toBe(50);
  });

  it("keeps the strategy cap as a hard ceiling", () => {
    const order = planQuoteBuy({
      symbol: "BTCUSDT",
      plannedUsdt: 200,
      freeUsdt: 500,
      remainingAssetCapUsdt: 30,
      referencePrice: 50000,
      rules,
    });
    expect(order.status).toBe("ready");
    expect(order.quoteAmount).toBe(30);
  });

  it("blocks orders below minimum notional after quantity rounding", () => {
    const order = planQuoteBuy({
      symbol: "BTCUSDT",
      plannedUsdt: 5.2,
      freeUsdt: 5.2,
      remainingAssetCapUsdt: 50,
      referencePrice: 100000,
      rules: { ...rules, stepSize: "0.001", minNotional: "5" },
    });
    expect(order.status).toBe("blocked");
  });

  it("blocks non-trading symbols and invalid amounts", () => {
    expect(planQuoteBuy({
      symbol: "BTCUSDT", plannedUsdt: 100, freeUsdt: 100, remainingAssetCapUsdt: 100,
      referencePrice: 50000, rules: { ...rules, status: "BREAK" },
    }).status).toBe("blocked");
    expect(planQuoteBuy({
      symbol: "BTCUSDT", plannedUsdt: Number.NaN, freeUsdt: 100, remainingAssetCapUsdt: 100,
      referencePrice: 50000, rules,
    }).status).toBe("blocked");
  });
});

describe("sell-side base protection", () => {
  it("never sells the locked long-term base", () => {
    const result = calculateSellableQty({
      actualFreeQty: 10,
      strategyOwnedQty: 10,
      baseRatio: 0.4,
      requestedCycleSellQty: 9,
      stepSize: "0.01",
      minQty: "0.01",
    });
    expect(result).toEqual({ quantity: 6, blocked: false });
  });

  it("uses the lower of exchange free balance and unlocked strategy quantity", () => {
    const result = calculateSellableQty({
      actualFreeQty: 2,
      strategyOwnedQty: 10,
      baseRatio: 0.4,
      requestedCycleSellQty: 8,
      stepSize: "0.01",
      minQty: "0.01",
    });
    expect(result.quantity).toBe(2);
  });
});

describe("idempotency and reconciliation", () => {
  it("generates a stable event key", () => {
    const input = { symbol: "btc", side: "BUY" as const, strategyEventId: "2026-W47", tranche: "head" };
    expect(makeExecutionKey(input)).toBe(makeExecutionKey(input));
    expect(makeExecutionKey(input)).not.toBe(makeExecutionKey({ ...input, tranche: "add-1" }));
  });

  it("never retries an ambiguous submit outcome", () => {
    expect(nextStatusAfterSubmit({ accepted: false, definitive: false, executedQty: 0, requestedQty: 1 }))
      .toBe("reconcile-required");
    expect(canSubmitAgain("reconcile-required")).toBe(false);
  });

  it("merges cumulative fills without allowing the fill totals to move backwards", () => {
    const current = {
      eventKey: "evt-a", clientOrderId: "client-a", symbol: "BTCUSDT", side: "BUY" as const,
      status: "submitting" as const, requestedQty: 0.01, executedQty: 0, cumulativeQuote: 0, updatedAt: 1,
    };
    const updated = mergeExecutionFill(current, { executedQty: 0.004, cumulativeQuote: 200, updatedAt: 2 });
    expect(updated.status).toBe("partially-filled");
    expect(updated.executedQty).toBe(0.004);
    expect(() => mergeExecutionFill(updated, { executedQty: 0.003, cumulativeQuote: 150, updatedAt: 3 }))
      .toThrow("成交累计值无效或发生倒退");
  });
});
