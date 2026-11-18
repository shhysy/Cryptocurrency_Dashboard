import { describe, expect, it } from "vitest";
import { replayPositionLedger } from "./position-accounting";
import type { ExecutionFill } from "./types";

const buy = (over: Partial<ExecutionFill> = {}): ExecutionFill => ({
  fillId: "1", orderId: "10", symbol: "BTCUSDT", side: "BUY",
  time: 1, price: 100, qty: 1, quoteQty: 100,
  commission: 0, commissionAsset: "USDT", commissionUsdt: 0, ...over,
});

const sell = (over: Partial<ExecutionFill> = {}): ExecutionFill => ({
  fillId: "2", orderId: "11", symbol: "BTCUSDT", side: "SELL",
  time: 2, price: 150, qty: 0.2, quoteQty: 30,
  commission: 0, commissionAsset: "USDT", commissionUsdt: 0, ...over,
});

describe("V3.3 position ledger replay", () => {
  it("splits net buys into long-term base and cycle inventory", () => {
    const result = replayPositionLedger([buy()], 0.4);
    expect(result.baseQty).toBeCloseTo(0.4);
    expect(result.cycleQty).toBeCloseTo(0.6);
    expect(result.totalQty).toBeCloseTo(1);
    expect(result.costBasisUsdt).toBe(100);
    expect(result.averageCostUsdt).toBe(100);
  });

  it("does not double-count a base-asset buy commission", () => {
    const result = replayPositionLedger([buy({
      qty: 1, commission: 0.01, commissionAsset: "BTC", commissionUsdt: 1,
    })], 0.4);
    expect(result.totalQty).toBeCloseTo(0.99);
    expect(result.costBasisUsdt).toBe(100);
    expect(result.averageCostUsdt).toBeCloseTo(100 / 0.99);
  });

  it("counts quote-asset buy fees in cost basis", () => {
    const result = replayPositionLedger([buy({
      commission: 0.2, commissionAsset: "USDT", commissionUsdt: 0.2,
    })], 0.4);
    expect(result.costBasisUsdt).toBeCloseTo(100.2);
    expect(result.totalQty).toBe(1);
  });

  it("ordinary sells reduce cycle inventory and calculate realized PnL", () => {
    const result = replayPositionLedger([
      buy(),
      { ...sell(), sellKind: "take_profit" },
    ], 0.4);
    expect(result.baseQty).toBeCloseTo(0.4);
    expect(result.cycleQty).toBeCloseTo(0.4);
    expect(result.costBasisUsdt).toBeCloseTo(80);
    expect(result.realizedPnlUsdt).toBeCloseTo(10);
    expect(result.realizedSellCount).toBe(1);
  });

  it("base reduction consumes protected base only", () => {
    const result = replayPositionLedger([
      buy(),
      { ...sell({ qty: 0.1, quoteQty: 15 }), sellKind: "base_reduce" },
    ], 0.4);
    expect(result.baseQty).toBeCloseTo(0.3);
    expect(result.cycleQty).toBeCloseTo(0.6);
  });

  it("accounts for base-asset sell fee as additional disposed quantity, not a second proceeds fee", () => {
    const result = replayPositionLedger([
      buy(),
      { ...sell({ qty: 0.2, commission: 0.002, commissionAsset: "BTC", commissionUsdt: 0.3 }), sellKind: "take_profit" },
    ], 0.4);
    expect(result.cycleQty).toBeCloseTo(0.398);
    expect(result.realizedPnlUsdt).toBeCloseTo(9.8);
  });

  it("subtracts quote-asset sell fees from proceeds", () => {
    const result = replayPositionLedger([
      buy(),
      { ...sell({ commission: 0.3, commissionAsset: "USDT", commissionUsdt: 0.3 }), sellKind: "take_profit" },
    ], 0.4);
    expect(result.realizedPnlUsdt).toBeCloseTo(9.7);
  });

  it("rejects selling more than the protected base or cycle inventory", () => {
    expect(() => replayPositionLedger([
      buy(), { ...sell({ qty: 0.7 }), sellKind: "take_profit" },
    ], 0.4)).toThrow("超过可用周期仓");
    expect(() => replayPositionLedger([
      buy(), { ...sell({ qty: 0.5 }), sellKind: "base_reduce" },
    ], 0.4)).toThrow("超过可用长期底仓");
  });

  it("rejects sell fills without an event kind", () => {
    expect(() => replayPositionLedger([buy(), sell()], 0.4)).toThrow("缺少有效卖出事件类型");
  });

  it("rejects invalid base ratios and malformed pairs", () => {
    expect(() => replayPositionLedger([buy()], 1.2)).toThrow("底仓比例");
    expect(() => replayPositionLedger([buy({ symbol: "BTCUSDC" })], 0.4)).toThrow("交易对");
  });
});
