import { describe, expect, it } from "vitest";
import { isBuyAssetEligible, watchlist } from "./watchlist.config";

describe("策略3.3资产池买入审核", () => {
  it("仅允许工作簿明确通过且六项基本面风险均为否的BTC和PAXG", () => {
    expect(isBuyAssetEligible("BTC")).toBe(true);
    expect(isBuyAssetEligible("PAXG")).toBe(true);
    expect(isBuyAssetEligible("ETH")).toBe(false);
    expect(isBuyAssetEligible("BNB")).toBe(false);
    expect(isBuyAssetEligible("UNI")).toBe(false);
    expect(isBuyAssetEligible("CL")).toBe(false);
    expect(isBuyAssetEligible("UNKNOWN")).toBe(false);
  });

  it("缺失或任一基本面风险为真时拒绝买入", () => {
    const eth = watchlist.find((item) => item.symbol === "ETH")!;
    expect(eth.buyReview?.whitelist).toBe("pending");
    const btc = watchlist.find((item) => item.symbol === "BTC")!;
    expect(Object.values(btc.buyReview!.fundamentals)).toHaveLength(6);
    expect(Object.values(btc.buyReview!.fundamentals).every((value) => value === false)).toBe(true);
  });
});
