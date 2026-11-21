import { describe, expect, it } from "vitest";
import { createBinanceReconcileAdapter } from "./binance-reconcile.server";
import { dispatchReconcileIntentTask, type InternalCoordinator } from "./reconcile-intent-dispatcher.server";

const task = {
  taskId: "v33:event-55", taskType: "reconcile_intent" as const,
  dueAt: 1, attempt: 1, leaseToken: "scheduler-token-123456", leaseUntil: 999999,
};
const order = {
  symbol: "BTCUSDT", orderId: 55, clientOrderId: "client-55", side: "SELL",
  status: "CANCELED", origQty: "0.01000000", executedQty: "0.00400000",
  cummulativeQuoteQty: "260.00", time: 100, updateTime: 300,
};
const trade = {
  id: 101, orderId: 55, symbol: "BTCUSDT", isBuyer: false,
  price: "65000.00", qty: "0.00400000", quoteQty: "260.00",
  commission: "0.00000400", commissionAsset: "BTC", time: 200,
};
const rules = { symbols: [{
  symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT", filters: [],
}] };

function makeCoordinator(options: {
  context?: Record<string, unknown>;
  status?: number;
  expired?: boolean;
} = {}) {
  const calls: Array<{ path: string; body?: Record<string, unknown> }> = [];
  const coordinator: InternalCoordinator = {
    async fetch(input, init) {
      const url = new URL(String(input));
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      calls.push({ path: url.pathname, body });
      if (url.pathname === "/internal/reconcile-context") {
        return Response.json(options.context ?? {
          intentId: task.taskId, state: "unknown", symbol: "BTCUSDT", side: "SELL",
          clientOrderId: "client-55", attempt: 1, leaseToken: "account-token-123456",
          leaseUntil: options.expired ? 1 : 999999, terminal: false,
        }, { status: options.status ?? 200 });
      }
      if (url.pathname === "/internal/takeover") {
        return Response.json({ ok: true, leaseToken: "new-account-token-123456" });
      }
      return Response.json({ ok: true });
    },
  };
  return { coordinator, calls };
}

function makeAdapter(status = "CANCELED") {
  return createBinanceReconcileAdapter(async <T>(path: string) => {
    if (path === "/api/v3/order") return { ...order, status } as T;
    if (path === "/api/v3/myTrades") return [trade] as T;
    if (path === "/api/v3/exchangeInfo") return rules as T;
    throw new Error("unexpected");
  });
}

describe("reconcile_intent后台只读任务分发", () => {
  it("只在终态成交完整时调用finalize并ack", async () => {
    const { coordinator, calls } = makeCoordinator();
    await expect(dispatchReconcileIntentTask(coordinator, task, makeAdapter(), 10))
      .resolves.toBe("completed");
    expect(calls.map((call) => call.path)).toContain("/internal/scheduler/renew");
    expect(calls.map((call) => call.path)).toContain("/internal/finalize");
    expect(calls.map((call) => call.path)).toContain("/internal/scheduler/ack");
    const finalize = calls.find((call) => call.path === "/internal/finalize")?.body;
    expect(finalize).toMatchObject({
      schedulerTaskId: task.taskId, schedulerAttempt: task.attempt,
      schedulerLeaseToken: task.leaseToken, exchangeOrderId: "55",
    });
  });

  it("活动订单只安排重试，不会调用finalize", async () => {
    const { coordinator, calls } = makeCoordinator();
    await expect(dispatchReconcileIntentTask(coordinator, task, makeAdapter("PARTIALLY_FILLED"), 10))
      .resolves.toBe("retry_scheduled");
    expect(calls.map((call) => call.path)).toContain("/internal/scheduler/retry");
    expect(calls.map((call) => call.path)).not.toContain("/internal/finalize");
  });

  it("过期账户租约必须先takeover，且保留原订单clientOrderId", async () => {
    const { coordinator, calls } = makeCoordinator({ expired: true });
    await dispatchReconcileIntentTask(coordinator, task, makeAdapter(), 10);
    expect(calls.map((call) => call.path)).toContain("/internal/takeover");
    const finalize = calls.find((call) => call.path === "/internal/finalize")?.body;
    expect(finalize?.leaseToken).toBe("new-account-token-123456");
  });

  it("订单已终态时只ack任务，不再访问Binance或finalize", async () => {
    const { coordinator, calls } = makeCoordinator({
      context: { intentId: task.taskId, terminal: true },
    });
    await expect(dispatchReconcileIntentTask(coordinator, task, makeAdapter(), 10))
      .resolves.toBe("completed");
    expect(calls.map((call) => call.path)).toEqual([
      "/internal/reconcile-context", "/internal/scheduler/ack",
    ]);
  });
});
