import { describe, expect, it } from "vitest";
import {
  allocateFlexibleEarnRedemption,
  availableFlexibleEarnUsdt,
  createEarnRedemptionIntents,
  isEarnRedemptionCredited,
  matchEarnRedemptionRecord,
  markEarnRedemptionAmbiguous,
  transitionEarnRedemption,
} from "./earn-redemption";

describe("Simple Earn redemption intent", () => {
  it("applies a product reservation only once when the API returns multiple position rows", () => {
    const positions = [
      { asset: "USDT", productId: "same-product", amount: "40" },
      { asset: "USDT", productId: "same-product", amount: "60" },
    ];
    expect(availableFlexibleEarnUsdt(positions, { "same-product": 50 })).toBe(50);
    expect(allocateFlexibleEarnRedemption(50, positions, { "same-product": 50 })).toEqual([
      { productId: "same-product", amountUsdt: 10 },
      { productId: "same-product", amountUsdt: 40 },
    ]);
  });

  it("subtracts existing local redemption reservations before allocating another order", () => {
    const positions = [
      { asset: "USDT", productId: "p1", amount: "100", redeemingAmt: "0", freezeAmount: "0" },
    ];
    expect(availableFlexibleEarnUsdt(positions, { p1: 60 })).toBe(40);
    expect(allocateFlexibleEarnRedemption(30, positions, { p1: 60 })).toEqual([
      { productId: "p1", amountUsdt: 30 },
    ]);
    expect(() => allocateFlexibleEarnRedemption(50, positions, { p1: 60 }))
      .toThrow("可赎回余额不足");
  });


  it("allocates only the requested shortfall across Flexible products", () => {
    expect(allocateFlexibleEarnRedemption(75, [
      { asset: "USDT", productId: "p1", amount: "30", redeemingAmt: "5", freezeAmount: "0" },
      { asset: "USDT", productId: "p2", amount: "80", redeemingAmt: "0", freezeAmount: "10" },
      { asset: "BTC", productId: "p3", amount: "1" },
    ])).toEqual([
      { productId: "p1", amountUsdt: 25 },
      { productId: "p2", amountUsdt: 50 },
    ]);
  });

  it("rejects insufficient funds and missing product IDs", () => {
    expect(() => allocateFlexibleEarnRedemption(100, [
      { asset: "USDT", productId: "p1", amount: "99" },
    ])).toThrow("可赎回余额不足");
    expect(() => allocateFlexibleEarnRedemption(10, [
      { asset: "USDT", amount: "20" },
    ])).toThrow("缺少 productId");
  });

  it("creates stable per-order/product idempotency keys", () => {
    const first = createEarnRedemptionIntents({
      orderId: "buy-123",
      allocations: [{ productId: "flex-1", amountUsdt: 12.5 }],
      now: 100,
    });
    const second = createEarnRedemptionIntents({
      orderId: "buy-123",
      allocations: [{ productId: "flex-1", amountUsdt: 12.5 }],
      now: 200,
    });
    expect(first[0].id).toBe(second[0].id);
    expect(first[0].createdAt).toBe(100);
  });

  it("moves an ambiguous submit to reconciliation and prevents blind retry", () => {
    const intent = createEarnRedemptionIntents({
      orderId: "buy-123",
      allocations: [{ productId: "flex-1", amountUsdt: 12.5 }],
      now: 100,
    })[0];
    const submitting = transitionEarnRedemption(intent, "submitting", {}, 110);
    const ambiguous = markEarnRedemptionAmbiguous(submitting, "network timeout", 120);
    expect(ambiguous.status).toBe("reconcile_required");
    expect(() => transitionEarnRedemption(ambiguous, "submitting")).toThrow("不允许赎回状态");
    expect(() => transitionEarnRedemption(ambiguous, "submitted")).toThrow("未通过赎回历史记录核实");
  });

  it("allows reconciliation to resume only with a confirmed exchange redemption ID", () => {
    const intent = createEarnRedemptionIntents({
      orderId: "buy-123",
      allocations: [{ productId: "flex-1", amountUsdt: 12.5 }],
    })[0];
    const ambiguous = markEarnRedemptionAmbiguous(
      transitionEarnRedemption(intent, "submitting"),
      "timeout",
    );
    const confirmed = transitionEarnRedemption(
      ambiguous, "submitted", { redemptionId: "redeem-987" },
    );
    expect(confirmed).toMatchObject({ status: "submitted", redemptionId: "redeem-987" });
  });

  it("does not allow terminal credited intents to change again", () => {
    const intent = createEarnRedemptionIntents({
      orderId: "buy-123",
      allocations: [{ productId: "flex-1", amountUsdt: 12.5 }],
    })[0];
    const submitting = transitionEarnRedemption(intent, "submitting");
    const submitted = transitionEarnRedemption(submitting, "submitted", { redemptionId: "r1" });
    const credited = transitionEarnRedemption(submitted, "credited");
    expect(() => transitionEarnRedemption(credited, "redeeming")).toThrow("不允许赎回状态");
  });
});


describe("Simple Earn redemption reconciliation", () => {
  const intent = createEarnRedemptionIntents({
    orderId: "buy-credit-check",
    allocations: [{ productId: "flexible-1", amountUsdt: 25 }],
    spotFreeBeforeUsdt: 10,
    now: 1000,
  })[0];

  it("matches only the exact redemption ID, asset, amount and Spot destination", () => {
    const submitted = { ...intent, redemptionId: "12345" };
    const record = {
      redeemId: 12345, asset: "USDT", amount: "25",
      destAccount: "SPOT", status: "SUCCESS",
    };
    expect(matchEarnRedemptionRecord(submitted, [record])).toEqual(record);
    expect(matchEarnRedemptionRecord(submitted, [
      { ...record, amount: "24" },
    ])).toBeNull();
    expect(matchEarnRedemptionRecord(intent, [record])).toBeNull();
  });

  it("requires Spot free to reflect the full redeemed amount", () => {
    expect(isEarnRedemptionCredited(intent, 34.99)).toBe(false);
    expect(isEarnRedemptionCredited(intent, 35)).toBe(true);
    expect(isEarnRedemptionCredited({ ...intent, spotFreeBeforeUsdt: null }, 100)).toBe(false);
  });
});
