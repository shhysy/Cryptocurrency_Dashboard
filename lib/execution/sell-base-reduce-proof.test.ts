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

  it("有证明的 executed 计入", () => {
    expect(confirmedBaseReduceFilledQty([baseEvent()])).toBeCloseTo(0.1);
  });

  it("同一 fillId 不重复累计", () => {
    const a = baseEvent({ eventKey: "sell:BTC:base_reduce:1:a", fillIds: ["same"] });
    const b = baseEvent({ eventKey: "sell:BTC:base_reduce:1:b", fillIds: ["same"], filledQty: 0.1 });
    expect(confirmedBaseReduceFilledQty([a, b])).toBeCloseTo(0.1);
  });
});
