import { describe, expect, it } from "vitest";
import { applyConfirmedBuyFill, createQueuedBuy, markOrderReconcileRequired, planPartialBuy, strategyEventId } from "./queue";

const order = createQueuedBuy({
  eventKey: "BTC:head:2026-W46",
  symbol: "BTC",
  quoteAsset: "USDT",
  strategyLabel: "头仓",
  plannedUsdt: 100,
  referencePrice: 50000,
  baseRatioAtSignal: 0.4,
  createdAt: 1000,
  strategyVersion: "V3.3",
}, 1000);

describe("待买订单与部分买入计划", () => {
  it("相同策略事件生成稳定 ID，避免刷新重复入队", () => {
    expect(strategyEventId("BTC:head:2026-W46")).toBe(order.id);
  });

  it("计划 100 USDT，账户只有 50 USDT，先执行 50，余款 50 排队", () => {
    expect(planPartialBuy(order, 50, 1000, 5)).toMatchObject({
      executableUsdt: 50,
      estimatedQty: 0.001,
      remainingUsdt: 50,
      status: "ready",
    });
  });

  it("账户 USDT 只有 3，低于最小下单额时不提交订单", () => {
    expect(planPartialBuy(order, 3, 1000, 5)).toMatchObject({
      executableUsdt: 0,
      remainingUsdt: 100,
      status: "below_min_notional",
    });
  });

  it("账户余额为 0 时保留待买金额等待下一次刷新", () => {
    expect(planPartialBuy(order, 0, 1000, 5).status).toBe("wait_balance");
  });

  it("单币额度只剩 20，最多执行 20", () => {
    expect(planPartialBuy(order, 100, 20, 5)).toMatchObject({
      executableUsdt: 20,
      remainingUsdt: 80,
    });
  });

  it("已确认 50 USDT 成交后，订单变成部分成交，剩余 50", () => {
    expect(applyConfirmedBuyFill(order, 50, 2000)).toMatchObject({
      filledUsdt: 50,
      remainingUsdt: 50,
      status: "partially_filled",
      updatedAt: 2000,
    });
  });

  it("在订单尚未完成交易所终态对账时，部分成交不会解除 attempt 锁", () => {
    const locked = markOrderReconcileRequired(order, "等待交易所订单终态");
    expect(applyConfirmedBuyFill(locked, 40, 2000)).toMatchObject({
      status: "reconcile_required",
      filledUsdt: 40,
      remainingUsdt: 60,
      lastError: "等待交易所订单终态",
    });
  });

  it("即使队列金额已全部成交，仍需等交易所终态对账后再解除 attempt 锁", () => {
    const locked = markOrderReconcileRequired(order, "等待交易所订单终态");
    expect(applyConfirmedBuyFill(locked, 100, 2000)).toMatchObject({
      status: "reconcile_required",
      filledUsdt: 100,
      remainingUsdt: 0,
    });
  });

  it("实际成交支出超过队列剩余金额时拒绝自动记账", () => {
    expect(() => applyConfirmedBuyFill(order, 101, 2000)).toThrow("实际成交支出超过订单剩余计划金额");
  });

  it("网络结果不确定时标记 reconcile_required，不能盲目重新下单", () => {
    expect(markOrderReconcileRequired(order, "request timeout").status).toBe("reconcile_required");
  });
  it("rejects a buy intent without a valid frozen base ratio", () => {
    expect(() => createQueuedBuy({
      eventKey: "ETH:head:2026-W46",
      symbol: "ETH",
      quoteAsset: "USDT",
      strategyLabel: "头仓",
      plannedUsdt: 75,
      referencePrice: 2000,
      baseRatioAtSignal: 1.2,
      createdAt: 1000,
      strategyVersion: "V3.3",
    }, 1000)).toThrow("历史底仓比例");
  });

});