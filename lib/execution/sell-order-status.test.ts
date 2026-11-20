import { describe, expect, it } from "vitest";
import {
  isExchangeSpotOrderTerminal,
  localEventEligibleForTakeProfitResume,
  localSellStatusAfterReconciledSnapshot,
  qtyMeetsOrExceeds,
  quantityTolerance,
  qtyIsStepMultiple,
} from "./sell-order-status";
import { isTerminalReconciledPartial } from "./sell-signal-queue";
import type { SellEventRecord } from "./sell-store.browser";

function proofPartial(over: Partial<SellEventRecord> = {}): SellEventRecord {
  return {
    eventKey: "sell:BTC:take_profit:2:止盈1",
    symbol: "BTC",
    kind: "take_profit",
    status: "partially_filled",
    requestedQty: 0.15,
    filledQty: 0.05,
    createdAt: 1,
    updatedAt: 1,
    exchangeOrderId: "103",
    fillIds: ["BTC-4"],
    lastError: null,
    exchangeTerminalStatus: "CANCELED",
    fillReconcileCompletedAt: 1_700_000_000_000,
    lotStepSize: 0.00001,
    ...over,
  };
}

describe("交易所终态与本地续卖边界", () => {
  it("NEW / PARTIALLY_FILLED 非终态，不得映射为 partially_filled", () => {
    expect(isExchangeSpotOrderTerminal("NEW")).toBe(false);
    expect(isExchangeSpotOrderTerminal("PARTIALLY_FILLED")).toBe(false);
    expect(localSellStatusAfterReconciledSnapshot({
      exchangeStatus: "NEW", executedQty: 0, origQty: 1,
    })).toBe("reconcile_required");
  });

  it("恰好满单 → executed；差一个 step / 0.49 step 不得抬成卖满", () => {
    const step = 0.001;
    expect(qtyMeetsOrExceeds(1, 1, step)).toBe(true);
    expect(qtyMeetsOrExceeds(1 - step, 1, step)).toBe(false);
    expect(qtyMeetsOrExceeds(1 - 0.49 * step, 1, step)).toBe(false);
    expect(localSellStatusAfterReconciledSnapshot({
      exchangeStatus: "CANCELED", executedQty: 1 - step, origQty: 1, stepSize: step,
    })).toBe("partially_filled");
  });

  it("极小数量 1e-10 / 1e-12：仅浮点容差，差量不得算满", () => {
    expect(qtyMeetsOrExceeds(1e-10, 1e-10)).toBe(true);
    expect(qtyMeetsOrExceeds(5e-11, 1e-10)).toBe(false);
    expect(qtyMeetsOrExceeds(1e-12 - 1e-15, 1e-12)).toBe(false);
  });

  it("stepSize 半步容差已废除：quantityTolerance 远小于 step", () => {
    const step = 0.001;
    expect(quantityTolerance(1, step)).toBeLessThan(step * 0.01);
  });

  it("qtyIsStepMultiple 校验合法步长", () => {
    expect(qtyIsStepMultiple(0.003, 0.001)).toBe(true);
    expect(qtyIsStepMultiple(0.0035, 0.001)).toBe(false);
  });

  it("缺少终态证明或非安全整数时间戳禁止 resume", () => {
    expect(localEventEligibleForTakeProfitResume(proofPartial({
      exchangeTerminalStatus: undefined,
    }))).toBe(false);
    expect(localEventEligibleForTakeProfitResume(proofPartial({
      fillReconcileCompletedAt: 1.5,
    }))).toBe(false);
  });

  it("fillIds 空串/重复禁止 resume", () => {
    expect(localEventEligibleForTakeProfitResume(proofPartial({
      fillIds: ["a", ""],
    }))).toBe(false);
    expect(localEventEligibleForTakeProfitResume(proofPartial({
      fillIds: ["a", "a"],
    }))).toBe(false);
  });

  it("终态 partially_filled 且证明齐全时允许 resume", () => {
    const terminalPartial = proofPartial();
    expect(localEventEligibleForTakeProfitResume(terminalPartial)).toBe(true);
    expect(isTerminalReconciledPartial(terminalPartial)).toBe(true);
  });
});
