import { describe, expect, it } from "vitest";
import { splitSpotAccountUsdtBalances, summarizeUsdtWallets } from "./wallet-funds";

describe("USDT wallet separation", () => {
  it("keeps Spot free separate from LDUSDT flexible Earn vouchers", () => {
    const split = splitSpotAccountUsdtBalances([
      { asset: "USDT", free: "12.5", locked: "1" },
      { asset: "LDUSDT", free: "80", locked: "0" },
    ]);
    expect(split).toEqual({
      spotFreeUsdt: 12.5,
      spotLockedUsdt: 1,
      flexibleEarnUsdt: 80,
    });
  });

  it("only treats Spot free less active reservations as executable", () => {
    const summary = summarizeUsdtWallets({
      spotFreeUsdt: 12.5,
      spotLockedUsdt: 1,
      flexibleEarnUsdt: 80,
      lockedEarnUsdt: 25,
      fundingUsdt: 40,
      otherWalletUsdt: 10,
      activeBuyReservationsUsdt: 5,
    });
    expect(summary).toMatchObject({
      totalTrackedUsdt: 168.5,
      nonSpotUsdt: 155,
      spotExecutableBeforeReservationsUsdt: 12.5,
      spotExecutableAfterReservationsUsdt: 7.5,
    });
  });

  it("does not let Earn or Funding balance cover a Spot buy shortfall", () => {
    const summary = summarizeUsdtWallets({
      spotFreeUsdt: 2,
      spotLockedUsdt: 0,
      flexibleEarnUsdt: 500,
      lockedEarnUsdt: 100,
      fundingUsdt: 300,
      otherWalletUsdt: 0,
      activeBuyReservationsUsdt: 0,
    });
    expect(summary.spotExecutableAfterReservationsUsdt).toBe(2);
    expect(summary.totalTrackedUsdt).toBe(902);
  });

  it("rejects negative, NaN, and infinite wallet amounts", () => {
    expect(() => summarizeUsdtWallets({
      spotFreeUsdt: -1, spotLockedUsdt: 0, flexibleEarnUsdt: 0,
      lockedEarnUsdt: 0, fundingUsdt: 0, otherWalletUsdt: 0,
      activeBuyReservationsUsdt: 0,
    })).toThrow("非负有限数值");
  });

  it("rejects malformed Binance amount strings instead of treating them as zero", () => {
    expect(() => splitSpotAccountUsdtBalances([
      { asset: "USDT", free: "oops", locked: "0" },
    ])).toThrow("余额无效");
  });
});
