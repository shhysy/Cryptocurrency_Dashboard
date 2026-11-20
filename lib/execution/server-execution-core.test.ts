import { describe, expect, it } from "vitest";
import {
  assertExecutionLease,
  canTransitionExecutionState,
  transitionExecutionIntent,
  validateServerExecutionIntent,
  type ServerExecutionIntent,
} from "./server-execution-core";

const base: ServerExecutionIntent = {
  intentId: "strategy3_3:BTC:head:2026W47",
  strategyEventId: "BTC:head:2026W47",
  strategyVersion: "3.3",
  symbol: "BTCUSDT",
  side: "BUY",
  quoteAsset: "USDT",
  amount: "100",
  state: "queued",
  attempt: 0,
  createdAt: 1_800_000_000_000,
  updatedAt: 1_800_000_000_000,
  exchangeOrderId: null,
  clientOrderId: null,
  exchangeTerminalAt: null,
  fillsReconciledAt: null,
  lastError: null,
};

describe("服务端订单意图验证", () => {
  it("接受策略3.3的USDT十进制订单意图", () => {
    expect(validateServerExecutionIntent(base)).toBeNull();
  });

  it.each([
    [{ ...base, strategyVersion: "3.2" }, "策略版本"],
    [{ ...base, symbol: "ETHBTC" }, "USDT"],
    [{ ...base, quoteAsset: "BTC" }, "USDT"],
    [{ ...base, amount: "1e-8" }, "十进制"],
    [{ ...base, amount: "-1" }, "十进制"],
    [{ ...base, amount: "0" }, "十进制"],
  ])("拒绝不符合策略/报价/金额约束的意图", (input, expected) => {
    expect(validateServerExecutionIntent(input as ServerExecutionIntent)).toContain(expected);
  });
});

describe("服务端订单状态机", () => {
  it("未知提交结果只能进入对账，不能直接回到queued", () => {
    expect(canTransitionExecutionState("unknown", "reconciling")).toBe(true);
    expect(canTransitionExecutionState("unknown", "queued")).toBe(false);
  });

  it("交易所仍开放的partial不能直接续开新attempt", () => {
    expect(canTransitionExecutionState("partial_open", "queued")).toBe(false);
    expect(canTransitionExecutionState("partial_open", "reconciling")).toBe(true);
  });

  it("只有终态快照与成交对账时间齐全才可标记partial_terminal", () => {
    const reconciled = transitionExecutionIntent(
      { ...base, state: "reconciling", attempt: 1, clientOrderId: "gpt-attempt-1" },
      "partial_terminal",
      1_800_000_000_010,
      { exchangeTerminalAt: 1_800_000_000_005, fillsReconciledAt: 1_800_000_000_006 },
    );
    expect(reconciled.state).toBe("partial_terminal");
    expect(() => transitionExecutionIntent(
      { ...base, state: "reconciling", attempt: 1, clientOrderId: "gpt-attempt-1" },
      "partial_terminal",
      1_800_000_000_010,
    )).toThrow("交易所终态快照");
  });

  it("提交前必须先保存clientOrderId与attempt", () => {
    expect(() => transitionExecutionIntent(
      { ...base, state: "reserved" },
      "submitting",
      1_800_000_000_010,
      { attempt: 1 },
    )).toThrow("clientOrderId");
    const submitting = transitionExecutionIntent(
      { ...base, state: "reserved" },
      "submitting",
      1_800_000_000_010,
      { attempt: 1, clientOrderId: "gpt-attempt-1" },
    );
    expect(submitting.state).toBe("submitting");
  });

  it("租约写入必须匹配intent、attempt和token且未过期", () => {
    const lease = { intentId: base.intentId, attempt: 2, token: "lease-2", leaseUntil: 5000 };
    expect(() => assertExecutionLease(lease, lease, 4000)).not.toThrow();
    expect(() => assertExecutionLease(lease, { ...lease, token: "old-token" }, 4000)).toThrow("fencing token");
    expect(() => assertExecutionLease(lease, { ...lease, attempt: 1 }, 4000)).toThrow("fencing token");
    expect(() => assertExecutionLease(lease, lease, 5000)).toThrow("租约已过期");\n    expect(() => assertExecutionLease({ ...lease, leaseUntil: Number.NaN }, lease, 4000)).toThrow("租约已过期");\n    expect(() => assertExecutionLease(lease, { ...lease, token: "" }, 4000)).toThrow("fencing token");
  });
});
