import { describe, expect, it, vi } from "vitest";
import {
  LIVE_EARN_REDEMPTION_ENABLED,
  LIVE_SPOT_ORDER_SUBMISSION_ENABLED,
  LIVE_SPOT_SELL_SUBMISSION_ENABLED,
  redeemFlexibleEarnUsdt,
  submitSpotMarketSell,
  submitSpotMarketBuy,
  fetchSpotTradesForOrder,
  fetchSpotTrades,
  fetchBuyTrades,
} from "./binance.browser";

describe("Simple Earn redeem browser adapter", () => {
  it("is disabled by default and never sends a POST request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(LIVE_EARN_REDEMPTION_ENABLED).toBe(false);
    await expect(redeemFlexibleEarnUsdt({
      productId: "USDT-flexible-product",
      amountUsdt: 10,
    })).rejects.toThrow("真实理财赎回尚未启用");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});


describe("Binance Spot order adapter", () => {
  it("is disabled by default and never sends a BUY POST request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(LIVE_SPOT_ORDER_SUBMISSION_ENABLED).toBe(false);
    await expect(submitSpotMarketBuy({
      symbol: "BTCUSDT",
      quoteOrderQty: "10.00",
      clientOrderId: "gpt1234567890abcdef",
    })).rejects.toThrow("测试网买入开关未启用");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});


describe("Binance Spot sell adapter", () => {
  it("is disabled by default and never sends a SELL POST request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(LIVE_SPOT_SELL_SUBMISSION_ENABLED).toBe(false);
    await expect(submitSpotMarketSell({
      symbol: "BTCUSDT",
      quantity: "0.0001",
      clientOrderId: "gpt1234567890abcdef",
    })).rejects.toThrow("测试网卖出开关未启用");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});


describe("Binance 成交历史分页完整性", () => {
  const fullPage = (startId: number) => Array.from({ length: 1000 }, (_, index) => ({
    id: startId + index,
    orderId: 55,
    price: "50000",
    qty: "0.00001",
    quoteQty: "0.5",
    commission: "0",
    commissionAsset: "USDT",
    time: 1000 + index,
    isBuyer: true,
  }));

  it("指定订单成交查询达到20页上限仍返回满页时拒绝返回截断数据", async () => {
    let page = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify(fullPage(page++ * 1000 + 1)), { status: 200 }),
    );
    try {
      await expect(fetchSpotTradesForOrder("BTCUSDT", 55))
        .rejects.toThrow("达到分页安全上限");
      expect(fetchSpy).toHaveBeenCalledTimes(20);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("账户成交查询达到调用方页数上限仍返回满页时拒绝返回截断数据", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify(fullPage(1)), { status: 200 }),
    );
    try {
      await expect(fetchSpotTrades("BTCUSDT", 1))
        .rejects.toThrow("达到分页安全上限");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("BUY历史成交查询达到5页上限仍返回满页时拒绝返回截断数据", async () => {
    let page = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify(fullPage(page++ * 1000 + 1)), { status: 200 }),
    );
    try {
      await expect(fetchBuyTrades("BTC", "USDT"))
        .rejects.toThrow("达到分页安全上限");
      expect(fetchSpy).toHaveBeenCalledTimes(5);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
