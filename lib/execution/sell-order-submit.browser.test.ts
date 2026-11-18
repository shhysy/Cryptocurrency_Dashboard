import { describe, expect, it } from "vitest";
import {
  formatMarketSellQuantity,
  submitQueuedSellEvent,
} from "./sell-order-submit.browser";

describe("guarded Spot SELL submission orchestration", () => {
  it("formats an already step-aligned quantity without adding precision noise", () => {
    expect(formatMarketSellQuantity(0.012, 0.001)).toBe("0.012");
    expect(formatMarketSellQuantity(2, 0.01)).toBe("2");
    expect(formatMarketSellQuantity(0.00000001, 0.00000001)).toBe("0.00000001");
  });

  it("rejects before touching IndexedDB or Binance while the live switch is disabled", async () => {
    await expect(submitQueuedSellEvent("sell:BTC:take_profit:week-1"))
      .rejects.toThrow("现货实盘卖出尚未启用");
  });

  it("rejects malformed quantity and step size", () => {
    expect(() => formatMarketSellQuantity(0, 0.001)).toThrow("卖出数量或交易步长无效");
    expect(() => formatMarketSellQuantity(0.01, 0)).toThrow("卖出数量或交易步长无效");
  });
});
