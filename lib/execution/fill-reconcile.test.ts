import { describe, expect, it } from "vitest";
import { reconcileConfirmedBuyFills } from "./fill-reconcile";
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
      fills[0], { ...fills[0], quoteQty: 99 },
    ], "BTC", "USDT")).toThrow("价格、数量与成交金额不一致");
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
