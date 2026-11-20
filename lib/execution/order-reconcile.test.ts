import { describe, expect, it } from "vitest";
import { decideOrderReconciliation, isExchangeOrderTerminal } from "./order-reconcile";
import { clientOrderIdForEvent } from "./client-order-id";

describe("Binance 订单对账与幂等 ID", () => {
  it("相同事件与尝试次数生成相同且不超过 36 字符的客户端订单 ID", () => {
    const id = clientOrderIdForEvent("BTC:head:2026-W46", 0);
    expect(id).toBe(clientOrderIdForEvent("BTC:head:2026-W46", 0));
    expect(id.length).toBeLessThanOrEqual(36);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("不同尝试次数生成不同客户端订单 ID", () => {
    expect(clientOrderIdForEvent("BTC:head:2026-W46", 0))
      .not.toBe(clientOrderIdForEvent("BTC:head:2026-W46", 1));
  });

  it("NEW 状态绝不允许重发，且累计成交字段必须为零", () => {
    expect(decideOrderReconciliation({ status: "NEW", origQty: 0.01, executedQty: 0, cummulativeQuoteQty: 0, orderId: 1 }).action).toBe("wait");
    expect(decideOrderReconciliation({ status: "NEW", origQty: 0.01, executedQty: 0.001, cummulativeQuoteQty: 50, orderId: 1 }).action).toBe("manual_review");
  });

  it("部分成交状态先入账，不能重发，且必须有正的累计成交", () => {
    expect(decideOrderReconciliation({ status: "PARTIALLY_FILLED", origQty: 0.01, executedQty: 0.001, cummulativeQuoteQty: 50, orderId: 1 }))
      .toMatchObject({ action: "apply_partial_then_wait", executedQty: 0.001, quoteQty: 50 });
    expect(decideOrderReconciliation({ status: "PARTIALLY_FILLED", origQty: 0.01, executedQty: 0, cummulativeQuoteQty: 0, orderId: 1 }).action).toBe("manual_review");
  });

  it("FILLED 状态必须包含真实成交数量和订单 ID", () => {
    expect(decideOrderReconciliation({ status: "FILLED", origQty: 0.002, executedQty: 0.002, cummulativeQuoteQty: 100, orderId: 1 }).action).toBe("complete");
    expect(decideOrderReconciliation({ status: "FILLED", origQty: 0.002, executedQty: 0, cummulativeQuoteQty: 0, orderId: 1 }).action).toBe("manual_review");
    expect(decideOrderReconciliation({ status: "FILLED", origQty: 0.01, executedQty: 0.002, cummulativeQuoteQty: 100, orderId: 1 }).action).toBe("manual_review");
    expect(decideOrderReconciliation({ status: "FILLED", origQty: 0.002, executedQty: 0.002, cummulativeQuoteQty: 100, orderId: null }).action).toBe("manual_review");
  });

  it("零成交取消单才允许用新 attempt 重试", () => {
    expect(decideOrderReconciliation({ status: "CANCELED", origQty: 0.01, executedQty: 0, cummulativeQuoteQty: 0, orderId: 1 }).action).toBe("safe_to_retry");
  });


  it("EXPIRED_IN_MATCH 是终态：有成交先对账入账，零成交才可用新 attempt 重试", () => {
    expect(decideOrderReconciliation({
      status: "EXPIRED_IN_MATCH",
      origQty: 0.01,
      executedQty: 0.004,
      cummulativeQuoteQty: 200,
      orderId: 7,
    })).toMatchObject({
      action: "apply_partial_then_wait",
      executedQty: 0.004,
      quoteQty: 200,
    });
    expect(decideOrderReconciliation({
      status: "EXPIRED_IN_MATCH",
      origQty: 0.01,
      executedQty: 0,
      cummulativeQuoteQty: 0,
      orderId: 7,
    }).action).toBe("safe_to_retry");
  });

  it("未查到订单不能假定失败并重发", () => {
    expect(decideOrderReconciliation(null).action).toBe("manual_review");
  });

  it("微小订单的真实未成交差额不能被绝对容差误判为FILLED", () => {
    const decision = decideOrderReconciliation({
      status: "FILLED",
      origQty: 1e-10,
      executedQty: 1.00000005e-10,
      cummulativeQuoteQty: 0.000005,
      orderId: 9,
    });
    expect(decision.action).toBe("manual_review");
  });
});


describe("exchange order terminal lock", () => {
  it("keeps NEW and PARTIALLY_FILLED orders locked", () => {
    expect(isExchangeOrderTerminal("NEW")).toBe(false);
    expect(isExchangeOrderTerminal("PARTIALLY_FILLED")).toBe(false);
  });

  it("releases the submission lock only for terminal statuses", () => {
    expect(isExchangeOrderTerminal("FILLED")).toBe(true);
    expect(isExchangeOrderTerminal("CANCELED")).toBe(true);
    expect(isExchangeOrderTerminal("EXPIRED")).toBe(true);
    expect(isExchangeOrderTerminal("EXPIRED_IN_MATCH")).toBe(true);
    expect(isExchangeOrderTerminal("REJECTED")).toBe(true);
    expect(isExchangeOrderTerminal("UNKNOWN")).toBe(false);
  });
});
