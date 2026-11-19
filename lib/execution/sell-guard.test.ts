import { describe, expect, it } from "vitest";
import { guardSellIntent, makeSellEventKey, type SellGuardState } from "./sell-guard";

const state = (over: Partial<SellGuardState> = {}): SellGuardState => ({
  executedEventKeys: [],
  pendingEventKeys: [],
  cycleInitialQty: 0.1,
  indicatorProfitSoldQty: 0,
  lastIndicatorProfitAt: null,
  baseReduceExecuted: false,
  ...over,
});

describe("自动卖出幂等与仓位保护", () => {
  it("为同一策略事件生成稳定键", () => {
    expect(makeSellEventKey("BTC", "take_profit", "2026-W46-level-1"))
      .toBe("sell:BTC:take_profit:2026-W46-level-1");
  });

  it("已成交的止盈档位不得重复卖出", () => {
    const key = "sell:BTC:take_profit:2026-W46-level-1";
    expect(guardSellIntent({
      symbol: "BTC", kind: "take_profit", eventKey: key,
      desiredQty: 0.01, cycleAvailableQty: 0.02, baseAvailableQty: 0.01, now: 1,
    }, state({ executedEventKeys: [key] }))).toMatchObject({ allowed: false, qty: 0 });
  });

  it("处理中事件也不得重复提交", () => {
    const key = "sell:BTC:take_profit:2026-W46-level-1";
    expect(guardSellIntent({
      symbol: "BTC", kind: "take_profit", eventKey: key,
      desiredQty: 0.01, cycleAvailableQty: 0.02, baseAvailableQty: 0.01, now: 1,
    }, state({ pendingEventKeys: [key] })).allowed).toBe(false);
  });

  it("普通止盈只能卖周期仓，不得触及长期底仓", () => {
    expect(guardSellIntent({
      symbol: "BTC", kind: "take_profit", eventKey: "tp-1",
      desiredQty: 0.08, cycleAvailableQty: 0.06, baseAvailableQty: 0.04, now: 1,
    }, state())).toMatchObject({ allowed: true, qty: 0.06 });
  });

  it("指标止盈 2 周冷却", () => {
    expect(guardSellIntent({
      symbol: "BTC", kind: "indicator_profit", eventKey: "indicator-2",
      desiredQty: 0.02, cycleAvailableQty: 0.1, baseAvailableQty: 0.04, now: 20 * 864e5,
    }, state({ lastIndicatorProfitAt: 19 * 864e5 })).allowed).toBe(false);
  });

  it("指标止盈累计不超过周期仓初始数量的 50%", () => {
    expect(guardSellIntent({
      symbol: "ETH", kind: "indicator_profit", eventKey: "indicator-1",
      desiredQty: 0.08, cycleAvailableQty: 0.1, baseAvailableQty: 0.02, now: 30 * 864e5,
    }, state({ cycleInitialQty: 0.1, indicatorProfitSoldQty: 0.04 })))
      .toMatchObject({ allowed: true });
    expect(guardSellIntent({
      symbol: "ETH", kind: "indicator_profit", eventKey: "indicator-1",
      desiredQty: 0.08, cycleAvailableQty: 0.1, baseAvailableQty: 0.02, now: 30 * 864e5,
    }, state({ cycleInitialQty: 0.1, indicatorProfitSoldQty: 0.04 })).qty).toBeCloseTo(0.01, 12);
  });

  it("底仓减仓必须显式允许且只能发生一次", () => {
    const req = {
      symbol: "BTC", kind: "base_reduce" as const, eventKey: "base-reduce-1",
      desiredQty: 0.02, cycleAvailableQty: 0.08, baseAvailableQty: 0.01, now: 1,
      allowBaseReduction: true,
    };
    expect(guardSellIntent(req, state()).qty).toBe(0.005);
    expect(guardSellIntent(req, state({ baseReduceExecuted: true })).allowed).toBe(false);
  });

  it("追踪止损只能动周期仓，不能卖底仓", () => {
    expect(guardSellIntent({
      symbol: "BTC", kind: "trail_stop", eventKey: "trail-1",
      desiredQty: 0.1, cycleAvailableQty: 0.03, baseAvailableQty: 0.05, now: 1,
    }, state())).toMatchObject({ allowed: true, qty: 0.03 });
  });

  it("底仓减仓未显式允许时拒绝", () => {
    expect(guardSellIntent({
      symbol: "BTC", kind: "base_reduce", eventKey: "base-1",
      desiredQty: 0.01, cycleAvailableQty: 0.02, baseAvailableQty: 0.02, now: 1,
    }, state())).toMatchObject({ allowed: false, qty: 0 });
  });

  it("底仓减仓 allowBaseReduction 为 false 时拒绝", () => {
    expect(guardSellIntent({
      symbol: "BTC", kind: "base_reduce", eventKey: "base-false",
      desiredQty: 0.01, cycleAvailableQty: 0.02, baseAvailableQty: 0.02, now: 1,
      allowBaseReduction: false,
    }, state()).allowed).toBe(false);
  });

  it("底仓减仓 allowBaseReduction 为 true 时按底仓 50% 放行", () => {
    expect(guardSellIntent({
      symbol: "BTC", kind: "base_reduce", eventKey: "base-true",
      desiredQty: 0.02, cycleAvailableQty: 0.08, baseAvailableQty: 0.01, now: 1,
      allowBaseReduction: true,
    }, state())).toMatchObject({ allowed: true, qty: 0.005 });
  });

  it("拒绝无效卖出数量（0、负数、NaN、Infinity）", () => {
    const base = {
      symbol: "BTC", kind: "take_profit" as const, eventKey: "bad-qty",
      cycleAvailableQty: 0.1, baseAvailableQty: 0.05, now: 1,
    };
    for (const desiredQty of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(guardSellIntent({ ...base, desiredQty, eventKey: `bad-${desiredQty}` }, state()).allowed).toBe(false);
    }
  });
});
