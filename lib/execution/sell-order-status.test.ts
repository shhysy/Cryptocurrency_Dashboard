import { describe, expect, it } from "vitest";
import {
  isExchangeSpotOrderTerminal,
  localEventEligibleForTakeProfitResume,
  localSellStatusAfterReconciledSnapshot,
  qtyMeetsOrExceeds,
  quantityTolerance,
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
    expect(localSellStatusAfterReconciledSnapshot({
      exchangeStatus: "PARTIALLY_FILLED", executedQty: 0.05, origQty: 0.15,
    })).toBe("reconcile_required");
  });

  it("CANCELED/EXPIRED/EXPIRED_IN_MATCH/REJECTED 终态且未卖满 → partially_filled", () => {
    for (const status of ["CANCELED", "EXPIRED", "EXPIRED_IN_MATCH", "REJECTED"]) {
      expect(isExchangeSpotOrderTerminal(status)).toBe(true);
      expect(localSellStatusAfterReconciledSnapshot({
        exchangeStatus: status, executedQty: 0.05, origQty: 0.15,
      })).toBe("partially_filled");
    }
  });

  it("FILLED 终态 → executed", () => {
    expect(localSellStatusAfterReconciledSnapshot({
      exchangeStatus: "FILLED", executedQty: 0.15, origQty: 0.15,
    })).toBe("executed");
  });

  it("极小数量用相对容差，不被固定 1e-8 误判为卖满", () => {
    expect(qtyMeetsOrExceeds(5e-11, 1e-10)).toBe(false);
    expect(localSellStatusAfterReconciledSnapshot({
      exchangeStatus: "CANCELED", executedQty: 5e-11, origQty: 1e-10,
    })).toBe("partially_filled");
  });

  it("stepSize 参与容差：差半步以内视为达标", () => {
    const step = 0.001;
    expect(quantityTolerance(1, step)).toBeCloseTo(0.00051, 12);
    expect(qtyMeetsOrExceeds(0.9996, 1, step)).toBe(true);
  });

  it("缺少终态证明或对账时间戳的旧 partial 禁止 resume（冻结）", () => {
    const legacy = proofPartial({
      exchangeTerminalStatus: undefined,
      fillReconcileCompletedAt: undefined,
    });
    expect(localEventEligibleForTakeProfitResume(legacy)).toBe(false);
    expect(isTerminalReconciledPartial(legacy)).toBe(false);
  });

  it("executed 禁止 resume", () => {
    const executedShort = proofPartial({ status: "executed", filledQty: 0.05 });
    expect(localEventEligibleForTakeProfitResume(executedShort)).toBe(false);
  });

  it("终态 partially_filled 且证明齐全时允许 resume", () => {
    const terminalPartial = proofPartial();
    expect(localEventEligibleForTakeProfitResume(terminalPartial)).toBe(true);
    expect(isTerminalReconciledPartial(terminalPartial)).toBe(true);
  });
});

describe("升级兼容：旧 partial 与交易所仍开放", () => {
  it("交易所仍为 PARTIALLY_FILLED → reconcile_required，不可 resume", () => {
    expect(localSellStatusAfterReconciledSnapshot({
      exchangeStatus: "PARTIALLY_FILLED", executedQty: 0.05, origQty: 0.15,
    })).toBe("reconcile_required");
    const legacyOpen = proofPartial({
      status: "reconcile_required",
      exchangeTerminalStatus: undefined,
      fillReconcileCompletedAt: undefined,
    });
    expect(localEventEligibleForTakeProfitResume(legacyOpen)).toBe(false);
  });
});
