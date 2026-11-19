import { describe, expect, it } from "vitest";
import { canTransitionSellEventStatus } from "./sell-store.browser";

describe("卖出事件部分成交状态转换", () => {
  it("允许部分成交后继续对账并最终收敛", () => {
    expect(canTransitionSellEventStatus("pending", "reconcile_required")).toBe(true);
    expect(canTransitionSellEventStatus("reconcile_required", "partially_filled")).toBe(true);
    expect(canTransitionSellEventStatus("partially_filled", "reconcile_required")).toBe(true);
    expect(canTransitionSellEventStatus("partially_filled", "executed")).toBe(true);
    expect(canTransitionSellEventStatus("partially_filled", "blocked")).toBe(true);
  });

  it("不允许终态事件重新进入提交流程", () => {
    expect(canTransitionSellEventStatus("executed", "pending")).toBe(false);
    expect(canTransitionSellEventStatus("blocked", "reconcile_required")).toBe(false);
    expect(canTransitionSellEventStatus("executed", "reconcile_required")).toBe(false);
  });
});
