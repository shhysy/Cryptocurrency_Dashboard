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
    expect(localSellStatusAfterReconciledSnapshot({
      exchangeStatus: "FILLED", executedQty: 1e-10, origQty: 1e-10,
    })).toBe("executed");
  });

  it("stepSize 参与容差：差半步以内视为达标", () => {
    const step = 0.001;
    expect(quantityTolerance(1, step)).toBeCloseTo(0.00051, 12);
    expect(qtyMeetsOrExceeds(0.9996, 1, step)).toBe(true);
    expect(qtyMeetsOrExceeds(0.999, 1, step)).toBe(false);
  });

  it("本地仍为 reconcile_required 时禁止 resume", () => {
    const openLike: SellEventRecord = {
      eventKey: "sell:BTC:take_profit:2:止盈1",
      symbol: "BTC", kind: "take_profit", status: "reconcile_required",
      requestedQty: 0.15, filledQty: 0.05, createdAt: 1, updatedAt: 1,
      exchangeOrderId: "103", fillIds: ["BTC-4"], lastError: "仍未终态",
    };
    expect(localEventEligibleForTakeProfitResume(openLike)).toBe(false);
    expect(isTerminalReconciledPartial(openLike)).toBe(false);
  });

  it("executed 即使 filledQty < requestedQty 也禁止 resume", () => {
    const executedShort: SellEventRecord = {
      eventKey: "sell:BTC:take_profit:2:止盈1",
      symbol: "BTC", kind: "take_profit", status: "executed",
      requestedQty: 0.15, filledQty: 0.05, createdAt: 1, updatedAt: 1,
      exchangeOrderId: "103", fillIds: ["BTC-4"], lastError: null,
    };
    expect(localEventEligibleForTakeProfitResume(executedShort)).toBe(false);
    expect(isTerminalReconciledPartial(executedShort)).toBe(false);
  });

  it("终态 partially_filled 且成交齐全时允许 resume 资格", () => {
    const terminalPartial: SellEventRecord = {
      eventKey: "sell:BTC:take_profit:2:止盈1",
      symbol: "BTC", kind: "take_profit", status: "partially_filled",
      requestedQty: 0.15, filledQty: 0.05, createdAt: 1, updatedAt: 1,
      exchangeOrderId: "103", fillIds: ["BTC-4"], lastError: null,
    };
    expect(localEventEligibleForTakeProfitResume(terminalPartial)).toBe(true);
    expect(isTerminalReconciledPartial(terminalPartial)).toBe(true);
  });
});
