import { describe, expect, it } from "vitest";
import { confirmedBaseReduceFilledQty } from "./sell-signal-queue";
import type { SellEventRecord } from "./sell-store.browser";

function baseEvent(over: Partial<SellEventRecord> = {}): SellEventRecord {
  return {
    eventKey: "sell:BTC:base_reduce:1:底仓减仓",
    symbol: "BTC",
    kind: "base_reduce",
    status: "executed",
    requestedQty: 0.1,
    filledQty: 0.1,
    createdAt: 1,
    updatedAt: 1,
    exchangeOrderId: "9",
    fillIds: ["br1"],
    lastError: null,
    exchangeTerminalStatus: "FILLED",
    fillReconcileCompletedAt: 1_700_000_000_000,
    ...over,
  };
}

describe("底仓减仓成交仅统计有证明的记录", () => {
  it("无终态证明的旧 executed 不计入", () => {
    expect(confirmedBaseReduceFilledQty([baseEvent({
      exchangeTerminalStatus: undefined,
      fillReconcileCompletedAt: undefined,
    })])).toBe(0);
  });

  it("NEW/PARTIALLY_FILLED 等非终态状态值不计入", () => {
    expect(confirmedBaseReduceFilledQty([baseEvent({ exchangeTerminalStatus: "NEW" })])).toBe(0);
    expect(confirmedBaseReduceFilledQty([baseEvent({ exchangeTerminalStatus: "PARTIALLY_FILLED" })])).toBe(0);
  });

  it("有证明的 executed 计入", () => {
    expect(confirmedBaseReduceFilledQty([baseEvent()])).toBeCloseTo(0.1);
  });

  it("完全重复 fillId 只计一次", () => {
    const a = baseEvent({ eventKey: "a", fillIds: ["same"] });
    const b = baseEvent({ eventKey: "b", fillIds: ["same"], filledQty: 0.1 });
    expect(confirmedBaseReduceFilledQty([a, b])).toBeCloseTo(0.1);
  });

  it("部分重叠 fillIds 整条冲突事件拒绝计入", () => {
    const a = baseEvent({ eventKey: "a", fillIds: ["x", "y"], filledQty: 0.1 });
    const b = baseEvent({ eventKey: "b", fillIds: ["y", "z"], filledQty: 0.05 });
    expect(confirmedBaseReduceFilledQty([a, b])).toBeCloseTo(0.1);
  });
});
