import { describe, expect, it } from "vitest";
import {
  PREP_PLAN_KIND,
  buildInitialPrepPlan,
  rebuildPrepPlanAfterTakeProfit,
  refreshTakeProfitsAfterReplenish,
  validatePrepPlan,
} from "./prep-orders";
import { prepPlanToCsv } from "./prep-orders-csv";

describe("预备订单人工计划", () => {
  it("头仓后生成补仓、备用金与止盈，并标记为人工计划", () => {
    const plan = buildInitialPrepPlan({ symbol: "btc", headPrice: 100_000, avgCost: 100_000, now: 1 });
    expect(plan.planKind).toBe(PREP_PLAN_KIND);
    expect(plan.symbol).toBe("BTC");
    expect(plan.phase).toBe("initial");
    expect(plan.hasTakenProfit).toBe(false);
    const pending = plan.orders.filter((o) => o.status === "pending");
    expect(pending.some((o) => o.kind === "add")).toBe(true);
    expect(pending.some((o) => o.kind === "reserve")).toBe(true);
    expect(pending.some((o) => o.kind === "takeProfit")).toBe(true);
    expect(validatePrepPlan(plan)).toEqual([]);
  });

  it("拒绝无效价格与币种", () => {
    expect(() => buildInitialPrepPlan({ symbol: "BTC", headPrice: 0 })).toThrow(/头仓价/);
    expect(() => buildInitialPrepPlan({ symbol: "", headPrice: 1 })).toThrow(/币种/);
  });

  it("止盈后关闭头仓补仓，按均价生成回补并重算止盈", () => {
    const plan = rebuildPrepPlanAfterTakeProfit({
      symbol: "BTC",
      headPrice: 100_000,
      avgCost: 80_000,
      completedTakeProfitTiers: [1],
      now: 2,
    });
    expect(plan.phase).toBe("post_take_profit");
    expect(plan.hasTakenProfit).toBe(true);
    const headAdds = plan.orders.filter((o) => o.kind === "add" || o.kind === "reserve");
    expect(headAdds.every((o) => o.status === "cancelled")).toBe(true);
    const replenish = plan.orders.filter((o) => o.kind === "replenish" && o.status === "pending");
    expect(replenish.length).toBeGreaterThan(0);
    expect(replenish[0].triggerPrice).toBeLessThan(80_000);
    const tp1 = plan.orders.find((o) => o.kind === "takeProfit" && o.tierIndex === 1);
    expect(tp1?.status).toBe("done");
    const tp2 = plan.orders.find((o) => o.kind === "takeProfit" && o.tierIndex === 2);
    expect(tp2?.status).toBe("pending");
    expect(tp2?.triggerPrice).toBeCloseTo(80_000 * 3, 0);
    expect(validatePrepPlan(plan)).toEqual([]);
  });

  it("回补后刷新止盈触发价", () => {
    const base = rebuildPrepPlanAfterTakeProfit({
      symbol: "ETH",
      headPrice: 2000,
      avgCost: 1800,
      completedTakeProfitTiers: [1],
    });
    const next = refreshTakeProfitsAfterReplenish(base, 1500, 3);
    expect(next.avgCost).toBe(1500);
    const tp2 = next.orders.find((o) => o.kind === "takeProfit" && o.tierIndex === 2);
    expect(tp2?.status).toBe("pending");
    expect(tp2?.triggerPrice).toBeCloseTo(1500 * 1.6, 0);
    expect(validatePrepPlan(next)).toEqual([]);
  });

  it("CSV 含 planKind=manual_prep 且中和公式注入", () => {
    const plan = buildInitialPrepPlan({ symbol: "BTC", headPrice: 100_000 });
    plan.orders[0].note = "=CMD()";
    const csv = prepPlanToCsv(plan);
    expect(csv).toContain("manual_prep");
    expect(csv).toContain("planKind");
    expect(csv).toContain("\"'=CMD()\"");
  });
});
