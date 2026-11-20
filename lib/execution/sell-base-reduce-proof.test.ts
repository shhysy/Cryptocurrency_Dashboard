import { describe, expect, it } from "vitest";
import { confirmedBaseReduceFilledQty, type BaseReduceLedgerFill } from "./sell-signal-queue";
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

function ledger(rows: BaseReduceLedgerFill[] = [
  { symbol: "BTC", fillId: "br1", qty: 0.1, side: "SELL", sellKind: "base_reduce" },
]): BaseReduceLedgerFill[] {
  return rows;
}

describe("底仓减仓成交仅统计有证明且台账一致的记录", () => {
  it("无台账 fail-closed 返回 0", () => {
    expect(confirmedBaseReduceFilledQty([baseEvent()])).toBe(0);
    expect(confirmedBaseReduceFilledQty([baseEvent()], [])).toBe(0);
  });

  it("台账 qty 与 filledQty 一致时计入", () => {
    expect(confirmedBaseReduceFilledQty([baseEvent()], ledger())).toBeCloseTo(0.1);
  });

  it("台账缺失 fill 或数量不一致不计入", () => {
    expect(confirmedBaseReduceFilledQty([baseEvent()], ledger([
      { symbol: "BTC", fillId: "other", qty: 0.1, side: "SELL", sellKind: "base_reduce" },
    ]))).toBe(0);
    expect(confirmedBaseReduceFilledQty([baseEvent()], ledger([
      { symbol: "BTC", fillId: "br1", qty: 0.05, side: "SELL", sellKind: "base_reduce" },
    ]))).toBe(0);
  });

  it("NEW 终态字段不计入", () => {
    expect(confirmedBaseReduceFilledQty([baseEvent({ exchangeTerminalStatus: "NEW" })], ledger())).toBe(0);
  });

  it("部分重叠 fillIds 整条冲突事件拒绝计入", () => {
    const a = baseEvent({ eventKey: "a", fillIds: ["x", "y"], filledQty: 0.1 });
    const b = baseEvent({ eventKey: "b", fillIds: ["y", "z"], filledQty: 0.05 });
    const led = ledger([
      { symbol: "BTC", fillId: "x", qty: 0.05, side: "SELL", sellKind: "base_reduce" },
      { symbol: "BTC", fillId: "y", qty: 0.05, side: "SELL", sellKind: "base_reduce" },
      { symbol: "BTC", fillId: "z", qty: 0.05, side: "SELL", sellKind: "base_reduce" },
    ]);
    expect(confirmedBaseReduceFilledQty([a, b], led)).toBeCloseTo(0.1);
  });

  it("重复 fillId 不得累加，事件不计", () => {
    const led = [
      { symbol: "BTC", fillId: "br1", qty: 0.05, side: "SELL", sellKind: "base_reduce" },
      { symbol: "BTC", fillId: "br1", qty: 0.05, side: "SELL", sellKind: "base_reduce" },
    ];
    expect(confirmedBaseReduceFilledQty([baseEvent()], led)).toBe(0);
  });

  it("缺少 sellKind 或 side 不可计入", () => {
    expect(confirmedBaseReduceFilledQty([baseEvent()], [
      { symbol: "BTC", fillId: "br1", qty: 0.1, side: "SELL" },
    ])).toBe(0);
    expect(confirmedBaseReduceFilledQty([baseEvent()], [
      { symbol: "BTC", fillId: "br1", qty: 0.1, sellKind: "base_reduce" },
    ])).toBe(0);
  });
});
