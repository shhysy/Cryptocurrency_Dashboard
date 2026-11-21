import { describe, expect, it } from "vitest";
import { isBuyAssetEligible, watchlist, type WatchItem } from "./watchlist.config";

describe("策略3.3资产池买入许可", () => {
  it("按用户确认允许BTC、PAXG、ETH、BNB、UNI自动新增买入", () => {
    for (const symbol of ["BTC", "PAXG", "ETH", "BNB", "UNI"]) {
      expect(isBuyAssetEligible(symbol)).toBe(true);
    }
  });

  it("合约信号品种、未列入资产池的品种仍禁止现货自动买入", () => {
    expect(isBuyAssetEligible("CL")).toBe(false);
    expect(isBuyAssetEligible("UNKNOWN")).toBe(false);
  });

  it("五种允许资产均显式启用，新增资产默认不会自动获得买入权限", () => {
    for (const symbol of ["BTC", "PAXG", "ETH", "BNB", "UNI"]) {
      expect(watchlist.find((item) => item.symbol === symbol)?.buyEnabled).toBe(true);
    }
    const unconfigured: WatchItem = { symbol: "NEW", name: "New asset", color: "#000000" };
    expect(unconfigured.buyEnabled).toBeUndefined();
  });
});
