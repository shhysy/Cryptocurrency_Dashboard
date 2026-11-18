import { describe, expect, it } from "vitest";
import { sumSimpleEarnUsdtPositions, summarizeUsdtWallets } from "./wallet-funds";

describe("Spot and Simple Earn USDT separation", () => {
  it("counts Flexible Earn as a separate planning source, excluding redeeming funds", () => {
    const summary = summarizeUsdtWallets({
      spotFreeUsdt: 12.5,
      spotLockedUsdt: 1,
      flexibleEarnUsdt: 80,
      flexibleEarnRedeemingUsdt: 5,
      lockedEarnUsdt: 25,
      lockedEarnRedeemingUsdt: 0,
      activeBuyReservationsUsdt: 5,
    });
    expect(summary).toMatchObject({
      totalTrackedUsdt: 118.5,
      spotFreeAfterReservationsUsdt: 7.5,
      flexibleEarnAvailableUsdt: 75,
      flexibleEarnPlanningUsdt: 75,
      totalPlanningUsdt: 82.5,
    });
  });

  it("does not treat locked Earn as immediately available planning funds", () => {
    const summary = summarizeUsdtWallets({
      spotFreeUsdt: 2, spotLockedUsdt: 0,
      flexibleEarnUsdt: 0, flexibleEarnRedeemingUsdt: 0,
      lockedEarnUsdt: 500, lockedEarnRedeemingUsdt: 0,
      activeBuyReservationsUsdt: 0,
    });
    expect(summary.totalTrackedUsdt).toBe(502);
    expect(summary.totalPlanningUsdt).toBe(2);
  });

  it("aggregates only USDT positions and separates redemption/frozen quantities", () => {
    expect(sumSimpleEarnUsdtPositions([
      { asset: "USDT", amount: "100", redeemingAmt: "10", freezeAmount: "5" },
      { asset: "USDT", amount: "20", redeemingAmt: "0", freezeAmount: "0" },
      { asset: "BTC", amount: "3" },
    ])).toEqual({ totalUsdt: 120, redeemingUsdt: 10, frozenUsdt: 5 });
  });

  it("rejects malformed or over-allocated Earn position amounts", () => {
    expect(() => sumSimpleEarnUsdtPositions([
      { asset: "USDT", amount: "bad" },
    ])).toThrow("非负有限数值");
    expect(() => sumSimpleEarnUsdtPositions([
      { asset: "USDT", amount: "10", redeemingAmt: "8", freezeAmount: "3" },
    ])).toThrow("超过持仓总量");
  });

  it("rejects negative, NaN, and infinite wallet amounts", () => {
    expect(() => summarizeUsdtWallets({
      spotFreeUsdt: -1, spotLockedUsdt: 0,
      flexibleEarnUsdt: 0, flexibleEarnRedeemingUsdt: 0,
      lockedEarnUsdt: 0, lockedEarnRedeemingUsdt: 0,
      activeBuyReservationsUsdt: 0,
    })).toThrow("非负有限数值");
  });
});
