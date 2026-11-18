import { describe, expect, it } from "vitest";
import {
  planSpotFirstBuyFunding,
  sumSimpleEarnUsdtPositions,
  summarizeUsdtWallets,
} from "./wallet-funds";

describe("Spot-first USDT funding", () => {
  it("uses Spot first and plans redemption for only the shortfall", () => {
    expect(planSpotFirstBuyFunding(100, 30, 500)).toEqual({
      requestedUsdt: 100,
      spotToUseUsdt: 30,
      flexibleEarnToRedeemUsdt: 70,
      unfundedUsdt: 0,
    });
  });

  it("does not redeem Earn when Spot has enough USDT", () => {
    expect(planSpotFirstBuyFunding(80, 100, 500)).toEqual({
      requestedUsdt: 80,
      spotToUseUsdt: 80,
      flexibleEarnToRedeemUsdt: 0,
      unfundedUsdt: 0,
    });
  });

  it("keeps the remaining amount queued when Spot plus Flexible Earn are insufficient", () => {
    expect(planSpotFirstBuyFunding(100, 20, 30)).toEqual({
      requestedUsdt: 100,
      spotToUseUsdt: 20,
      flexibleEarnToRedeemUsdt: 30,
      unfundedUsdt: 50,
    });
  });

  it("excludes redeeming and frozen Flexible Earn amounts from availability", () => {
    const summary = summarizeUsdtWallets({
      spotFreeUsdt: 12.5,
      spotLockedUsdt: 1,
      flexibleEarnUsdt: 80,
      flexibleEarnRedeemingUsdt: 5,
      flexibleEarnFrozenUsdt: 10,
      lockedEarnUsdt: 25,
      lockedEarnRedeemingUsdt: 0,
      activeBuyReservationsUsdt: 5,
    });
    expect(summary).toMatchObject({
      totalTrackedUsdt: 118.5,
      spotFreeAfterReservationsUsdt: 7.5,
      flexibleEarnAvailableUsdt: 65,
      flexibleEarnPlanningUsdt: 65,
      totalPlanningUsdt: 72.5,
    });
  });

  it("does not treat Locked Earn as immediately available", () => {
    const summary = summarizeUsdtWallets({
      spotFreeUsdt: 2, spotLockedUsdt: 0,
      flexibleEarnUsdt: 0, flexibleEarnRedeemingUsdt: 0,
      flexibleEarnFrozenUsdt: 0,
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

  it("rejects invalid planning amounts", () => {
    expect(() => planSpotFirstBuyFunding(-1, 0, 0)).toThrow("非负有限数值");
    expect(() => planSpotFirstBuyFunding(10, Number.NaN, 0)).toThrow("非负有限数值");
  });
});
