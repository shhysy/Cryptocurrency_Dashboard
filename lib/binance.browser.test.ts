import { describe, expect, it, vi } from "vitest";
import {
  LIVE_EARN_REDEMPTION_ENABLED,
  redeemFlexibleEarnUsdt,
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
