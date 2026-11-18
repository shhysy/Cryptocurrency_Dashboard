import { describe, expect, it, vi } from "vitest";
import {
  LIVE_EARN_REDEMPTION_ENABLED,
  LIVE_SPOT_ORDER_SUBMISSION_ENABLED,
  LIVE_SPOT_SELL_SUBMISSION_ENABLED,
  redeemFlexibleEarnUsdt,
  submitSpotMarketSell,
  submitSpotMarketBuy,
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
    })).rejects.toThrow("现货实盘买入尚未启用");
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
    })).rejects.toThrow("现货实盘卖出尚未启用");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
