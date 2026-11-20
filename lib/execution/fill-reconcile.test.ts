import { describe, expect, it } from "vitest";
import { assertDuplicateExecutionFillMatches, reconcileConfirmedBuyFills } from "./fill-reconcile";
import type { BinanceSpotTrade } from "../binance.browser";

const order = {
  orderId: 55,
  symbol: "BTCUSDT",
  executedQty: 0.002,
  cummulativeQuoteQty: 100,
};

const fills: BinanceSpotTrade[] = [{
  id: 1, orderId: 55, symbol: "BTCUSDT", price: 50000, qty: 0.002,
  quoteQty: 100, commission: 0.000001, commissionAsset: "BTC",
  time: 1000, isBuyer: true,
}];

describe("真实买入成交核对", () => {
  it("基础币手续费只减少净持仓数量，不计入 USDT 支出", () => {
    const result = reconcileConfirmedBuyFills(order, fills, "BTC", "USDT");
    expect(result.complete).toBe(true);
    expect(result.fills[0].commissionUsdt).toBe(0);
    expect(result.quoteCommissionUsdt).toBe(0);
  });

  it("报价币手续费直接计入 USDT 成本", () => {
    const result = reconcileConfirmedBuyFills(order, [{
      ...fills[0], commission: 0.1, commissionAsset: "USDT",
    }], "BTC", "USDT");
    expect(result.quoteCommissionUsdt).toBeCloseTo(0.1);
  });

  it("不猜测 BNB 等第三资产手续费的 USDT 价值", () => {
    expect(() => reconcileConfirmedBuyFills(order, [{
      ...fills[0], commission: 0.01, commissionAsset: "BNB",
    }], "BTC", "USDT")).toThrow("无法可靠换算为 USDT");
  });

  it("逐笔成交和订单累计数量不一致时不确认", () => {
    const result = reconcileConfirmedBuyFills(order, [], "BTC", "USDT");
    expect(result.complete).toBe(false);
    expect(result.reason).toContain("暂停自动记账");
  });

  it("忽略其他订单的成交，不混入本订单", () => {
    const result = reconcileConfirmedBuyFills(order, [{
      ...fills[0], orderId: 999,
    }], "BTC", "USDT");
    expect(result.complete).toBe(false);
    expect(result.fills).toHaveLength(0);
  });

  it("完全相同的重复成交 ID 只计入一次", () => {
    const result = reconcileConfirmedBuyFills(order, [fills[0], { ...fills[0] }], "BTC", "USDT");
    expect(result.complete).toBe(true);
    expect(result.fills).toHaveLength(1);
  });

  it("同一成交 ID 携带冲突数据时拒绝记账", () => {
    expect(() => reconcileConfirmedBuyFills(order, [
      fills[0], { ...fills[0], commission: 0.2, commissionAsset: "USDT" },
    ], "BTC", "USDT")).toThrow("同一 Binance 成交 ID 返回了冲突的成交数据");
  });

  it("成交价格乘数量与 quoteQty 不一致时拒绝记账", () => {
    expect(() => reconcileConfirmedBuyFills(order, [
      { ...fills[0], quoteQty: 99 },
    ], "BTC", "USDT")).toThrow("价格、数量与成交金额不一致");
  });

  it("订单成交数量为零但累计成交金额非零时拒绝", () => {
    expect(() => reconcileConfirmedBuyFills({
      ...order, executedQty: 0, cummulativeQuoteQty: 1,
    }, [], "BTC", "USDT")).toThrow("订单累计成交数据无效");
  });

  it("正确核对小于1e-8的BTC成交数量", () => {
    const tinyOrder = {
      orderId: 56,
      symbol: "BTCUSDT",
      executedQty: 1e-10,
      cummulativeQuoteQty: 0.000005,
    };
    const tinyFill: BinanceSpotTrade = {
      ...fills[0],
      id: 2,
      orderId: 56,
      qty: 1e-10,
      quoteQty: 0.000005,
      commission: 0,
    };
    const result = reconcileConfirmedBuyFills(tinyOrder, [tinyFill], "BTC", "USDT");
    expect(result.complete).toBe(true);
  });

  it("小于1e-8的成交数量差异不得被固定绝对容差吞掉", () => {
    const tinyOrder = {
      orderId: 57,
      symbol: "BTCUSDT",
      executedQty: 1e-10,
      cummulativeQuoteQty: 0.000005,
    };
    const oversizedFill: BinanceSpotTrade = {
      ...fills[0],
      id: 3,
      orderId: 57,
      qty: 2e-10,
      quoteQty: 0.00001,
      commission: 0,
    };
    const result = reconcileConfirmedBuyFills(tinyOrder, [oversizedFill], "BTC", "USDT");
    expect(result.complete).toBe(false);
    expect(result.reason).toContain("暂停自动记账");
  });
});

describe("真实卖出成交核对", () => {
  const sellOrder = { ...order, orderId: 77 };
  const sellFill: BinanceSpotTrade = {
    ...fills[0],
    id: 9,
    orderId: 77,
    isBuyer: false,
    commission: 0.1,
    commissionAsset: "USDT",
  };

  it("核对卖出订单累计成交并保留 USDT 手续费", async () => {
    const { reconcileConfirmedSellFills } = await import("./fill-reconcile");
    const result = reconcileConfirmedSellFills(sellOrder, [sellFill], "BTC", "USDT");
    expect(result.complete).toBe(true);
    expect(result.fills[0].side).toBe("SELL");
    expect(result.quoteCommissionUsdt).toBeCloseTo(0.1);
  });

  it("拒绝卖出订单中出现买入方向成交", async () => {
    const { reconcileConfirmedSellFills } = await import("./fill-reconcile");
    expect(() => reconcileConfirmedSellFills(sellOrder, [{ ...sellFill, isBuyer: true }], "BTC", "USDT"))
      .toThrow("出现买入方向记录");
  });


  it("卖出基础币手续费不重复计入 USDT 手续费", async () => {
    const { reconcileConfirmedSellFills } = await import("./fill-reconcile");
    const result = reconcileConfirmedSellFills(sellOrder, [{
      ...sellFill, commission: 0.0001, commissionAsset: "BTC",
    }], "BTC", "USDT");
    expect(result.complete).toBe(true);
    expect(result.fills[0].commissionUsdt).toBe(0);
    expect(result.quoteCommissionUsdt).toBe(0);
  });

  it("第三资产手续费不能被猜测", async () => {
    const { reconcileConfirmedSellFills } = await import("./fill-reconcile");
    expect(() => reconcileConfirmedSellFills(sellOrder, [{
      ...sellFill, commission: 0.01, commissionAsset: "BNB",
    }], "BTC", "USDT")).toThrow("无法可靠换算为 USDT");
  });

  it("小于1e-8的卖出成交差异不能被绝对容差吞掉", async () => {
    const { reconcileConfirmedSellFills } = await import("./fill-reconcile");
    const tinyOrder = {
      orderId: 78,
      symbol: "BTCUSDT",
      executedQty: 1e-10,
      cummulativeQuoteQty: 0.000005,
    };
    const tinyFill: BinanceSpotTrade = {
      ...sellFill,
      id: 10,
      orderId: 78,
      qty: 2e-10,
      quoteQty: 0.00001,
      commission: 0,
    };
    const result = reconcileConfirmedSellFills(tinyOrder, [tinyFill], "BTC", "USDT");
    expect(result.complete).toBe(false);
  });

  it("逐笔成交与订单累计值不一致时不确认", async () => {
    const { reconcileConfirmedSellFills } = await import("./fill-reconcile");
    const result = reconcileConfirmedSellFills(sellOrder, [], "BTC", "USDT");
    expect(result.complete).toBe(false);
  });

  it("卖出成交 ID 冲突时拒绝记账", async () => {
    const { reconcileConfirmedSellFills } = await import("./fill-reconcile");
    expect(() => reconcileConfirmedSellFills(sellOrder, [
      sellFill, { ...sellFill, commission: 0.2 },
    ], "BTC", "USDT")).toThrow("同一 Binance 成交 ID 返回了冲突的成交数据");
  });
});


describe("已入账卖出成交的跨轮询一致性", () => {
  const stored = {
    fillId: "9", orderId: "77", symbol: "BTCUSDT", side: "SELL" as const,
    time: 1000, price: 50000, qty: 0.002, quoteQty: 100,
    commission: 0.1, commissionAsset: "USDT", commissionUsdt: 0.1,
  };

  it("允许后续轮询返回完全相同的成交记录", () => {
    expect(() => assertDuplicateExecutionFillMatches(stored, "take_profit", { ...stored }, "take_profit")).not.toThrow();
  });

  it("拒绝同一成交 ID 的数量、手续费或卖出分类发生变化", () => {
    expect(() => assertDuplicateExecutionFillMatches(stored, "take_profit", { ...stored, qty: 0.003 }, "take_profit"))
      .toThrow("不同成交数据或卖出分类");
    expect(() => assertDuplicateExecutionFillMatches(stored, "take_profit", { ...stored, commission: 0.2 }, "take_profit"))
      .toThrow("不同成交数据或卖出分类");
    expect(() => assertDuplicateExecutionFillMatches(stored, "take_profit", { ...stored }, "base_reduce"))
      .toThrow("不同成交数据或卖出分类");
  });
});
