import { describe, expect, it } from "vitest";
import { replayPositionLedger } from "./position-accounting";
import type { ExecutionFill } from "./types";

type PositionFill = ExecutionFill & { baseRatioAtBuy?: number; sellKind?: string };

const buy = (over: Partial<PositionFill> = {}): PositionFill => ({
  fillId: "1", orderId: "10", symbol: "BTCUSDT", side: "BUY",
  time: 1, price: 100, qty: 1, quoteQty: 100,
  commission: 0, commissionAsset: "USDT", commissionUsdt: 0, baseRatioAtBuy: 0.4, ...over,
});

const sell = (over: Partial<PositionFill> = {}): PositionFill => ({
  fillId: "2", orderId: "11", symbol: "BTCUSDT", side: "SELL",
  time: 2, price: 150, qty: 0.2, quoteQty: 30,
  commission: 0, commissionAsset: "USDT", commissionUsdt: 0, ...over,
});

describe("V3.3 position ledger replay", () => {
  it("splits net buys into long-term base and cycle inventory", () => {
    const result = replayPositionLedger([buy()]);
    expect(result.baseQty).toBeCloseTo(0.4);
    expect(result.cycleQty).toBeCloseTo(0.6);
    expect(result.totalQty).toBeCloseTo(1);
    expect(result.costBasisUsdt).toBe(100);
    expect(result.averageCostUsdt).toBe(100);
  });

  it("does not double-count a base-asset buy commission", () => {
    const result = replayPositionLedger([buy({
      qty: 1, commission: 0.01, commissionAsset: "BTC", commissionUsdt: 1,
    })]);
    expect(result.totalQty).toBeCloseTo(0.99);
    expect(result.costBasisUsdt).toBe(100);
    expect(result.averageCostUsdt).toBeCloseTo(100 / 0.99);
  });

  it("uses the historical ratio on each buy even when later buys use a different ratio", () => {
    const result = replayPositionLedger([
      buy({ fillId: "1", time: 1, qty: 1, quoteQty: 100, baseRatioAtBuy: 0.4 }),
      buy({ fillId: "2", orderId: "12", time: 2, qty: 1, quoteQty: 200, baseRatioAtBuy: 0.2 }),
    ]);
    expect(result.baseQty).toBeCloseTo(0.6);
    expect(result.cycleQty).toBeCloseTo(1.4);
    expect(result.costBasisUsdt).toBe(300);
  });

  it("rejects legacy buy fills without a saved historical ratio", () => {
    const { baseRatioAtBuy: _ignored, ...legacy } = buy();
    expect(() => replayPositionLedger([legacy])).toThrow("禁止使用当前策略参数覆盖历史记录");
  });

  it("counts quote-asset buy fees in cost basis", () => {
    const result = replayPositionLedger([buy({
      commission: 0.2, commissionAsset: "USDT", commissionUsdt: 0.2,
    })]);
    expect(result.costBasisUsdt).toBeCloseTo(100.2);
    expect(result.totalQty).toBe(1);
  });

  it("ordinary sells reduce cycle inventory and calculate realized PnL", () => {
    const result = replayPositionLedger([
      buy(),
      { ...sell(), sellKind: "take_profit" },
    ]);
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
    ]);
    expect(result.baseQty).toBeCloseTo(0.3);
    expect(result.cycleQty).toBeCloseTo(0.6);
  });

  it("accounts for base-asset sell fee as additional disposed quantity, not a second proceeds fee", () => {
    const result = replayPositionLedger([
      buy(),
      { ...sell({ qty: 0.2, commission: 0.002, commissionAsset: "BTC", commissionUsdt: 0.3 }), sellKind: "take_profit" },
    ]);
    expect(result.cycleQty).toBeCloseTo(0.398);
    expect(result.realizedPnlUsdt).toBeCloseTo(9.8);
  });

  it("subtracts quote-asset sell fees from proceeds", () => {
    const result = replayPositionLedger([
      buy(),
      { ...sell({ commission: 0.3, commissionAsset: "USDT", commissionUsdt: 0.3 }), sellKind: "take_profit" },
    ]);
    expect(result.realizedPnlUsdt).toBeCloseTo(9.7);
  });

  it("rejects selling more than the protected base or cycle inventory", () => {
    expect(() => replayPositionLedger([
      buy(), { ...sell({ qty: 0.7 }), sellKind: "take_profit" },
    ])).toThrow("超过可用周期仓");
    expect(() => replayPositionLedger([
      buy(), { ...sell({ qty: 0.5 }), sellKind: "base_reduce" },
    ])).toThrow("超过可用长期底仓");
  });

  it("rejects sell fills without an event kind", () => {
    expect(() => replayPositionLedger([buy(), sell()])).toThrow("缺少有效卖出事件类型");
  });

  it("rejects invalid base ratios and malformed pairs", () => {
    expect(() => replayPositionLedger([buy({ baseRatioAtBuy: 1.2 })])).toThrow("历史底仓比例");
    expect(() => replayPositionLedger([buy({ symbol: "BTCUSDC" })])).toThrow("交易对");
  });
});

  it("requires local ledger quantity to match Binance free plus locked holdings", async () => {
    const { assertPositionMatchesExchange } = await import("./position-accounting");
    const position = replayPositionLedger([buy()]);
    expect(assertPositionMatchesExchange(position, {
      freeQty: 0.7, lockedQty: 0.3, totalQty: 1,
    })).toEqual({ freeBaseQty: 0.7, totalPositionQty: 1, protectedBaseQty: 0.4 });
    expect(() => assertPositionMatchesExchange(position, {
      freeQty: 0.7, lockedQty: 0.2, totalQty: 0.9,
    })).toThrow("不一致，暂停卖出预检");
  });


describe("position reconciliation diagnostics", () => {
  it("classifies an exchange-side surplus without modifying either quantity", async () => {
    const { buildPositionReconciliationReport } = await import("./position-accounting");
    const position = replayPositionLedger([buy()]);
    const report = buildPositionReconciliationReport(position, {
      freeQty: 1.1, lockedQty: 0, totalQty: 1.1,
    });
    expect(report).toMatchObject({
      status: "exchange_higher", ledgerQty: 1, exchangeTotalQty: 1.1,
      deltaQty: 0.1, canSell: false,
    });
  });

  it("classifies a ledger-side surplus and preserves free/locked detail", async () => {
    const { buildPositionReconciliationReport } = await import("./position-accounting");
    const report = buildPositionReconciliationReport(replayPositionLedger([buy()]), {
      freeQty: 0.5, lockedQty: 0.2, totalQty: 0.7,
    });
    expect(report).toMatchObject({
      status: "ledger_higher", ledgerQty: 1, exchangeFreeQty: 0.5,
      exchangeLockedQty: 0.2, deltaQty: -0.3, canSell: false,
    });
  });

  it("marks inconsistent Binance components as unsafe even if ledger total matches", async () => {
    const { buildPositionReconciliationReport } = await import("./position-accounting");
    const report = buildPositionReconciliationReport(replayPositionLedger([buy()]), {
      freeQty: 0.8, lockedQty: 0.3, totalQty: 1,
    });
    expect(report).toMatchObject({
      status: "exchange_components_invalid", canSell: false,
    });
  });

  it("marks a matched position as eligible for the separate strict preflight", async () => {
    const { buildPositionReconciliationReport } = await import("./position-accounting");
    const report = buildPositionReconciliationReport(replayPositionLedger([buy()]), {
      freeQty: 0.7, lockedQty: 0.3, totalQty: 1,
    });
    expect(report).toMatchObject({ status: "matched", canSell: true, deltaQty: 0 });
  });
});
