import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serverExecutionIntentId, type ServerExecutionIntent } from "../server-execution-core";
import { schedulerTaskRetryAt } from "../scheduler-task-core";
import type { SellEventRecord } from "../sell-store.browser";
import type { ExecutionFill } from "../types";
import { openLocalExecutionDatabase } from "./sqlite-database";
import { openLocalExecutionStore } from "./sqlite-store";
import { runTraderCycle } from "./trader-loop";
import { vi } from "vitest";

const NOW = 1_800_000_000_000;
const directories: string[] = [];

async function tempDbPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cryptodash-execution-store-"));
  directories.push(directory);
  return join(directory, "data", "trader.db");
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

function intent(
  side: "BUY" | "SELL" = "SELL",
  overrides: Partial<ServerExecutionIntent> = {},
): ServerExecutionIntent {
  const eventId = side === "BUY" ? "BTC:head:2026W47" : "BTC:takeProfit:2026W47";
  return {
    intentId: serverExecutionIntentId(eventId),
    strategyEventId: eventId,
    strategyVersion: "3.3",
    symbol: "BTCUSDT",
    side,
    quoteAsset: "USDT",
    amount: side === "BUY" ? "10" : "0.05",
    ...(side === "BUY" ? { baseRatioAtSignal: 0.7 } : {}),
    state: "queued",
    attempt: 0,
    createdAt: NOW,
    updatedAt: NOW,
    exchangeOrderId: null,
    clientOrderId: null,
    exchangeTerminalAt: null,
    fillsReconciledAt: null,
    lastError: null,
    ...overrides,
  };
}

async function claimAndSubmit(
  store: Awaited<ReturnType<typeof openLocalExecutionStore>>,
  value: ServerExecutionIntent,
) {
  const created = await store.createIntent(value);
  expect(created.created).toBe(true);
  const asset = value.side === "BUY" ? "USDT" : "BTC";
  const claim = await store.claimIntent({
    intentId: value.intentId,
    availableAsset: asset,
    availableAmount: value.side === "BUY" ? "100" : "1",
    snapshotAt: NOW,
    now: NOW,
    leaseMs: 30_000,
  });
  expect(claim).not.toBeNull();
  const current = claim!;
  await store.markSubmitting({
    intentId: value.intentId,
    attempt: current.lease.attempt,
    leaseToken: current.lease.token,
    clientOrderId: current.intent.clientOrderId!,
    now: NOW + 1,
  });
  await store.markUnknown({
    intentId: value.intentId,
    attempt: current.lease.attempt,
    leaseToken: current.lease.token,
    reason: "模拟POST响应丢失",
    now: NOW + 2,
  });
  const recoveredLease = await store.takeoverForReconciliation({
    intentId: value.intentId,
    attempt: current.lease.attempt,
    leaseToken: current.lease.token,
    now: NOW + 30_001,
  }, 30_000);
  expect(recoveredLease).not.toBeNull();
  return { claim: current, lease: recoveredLease! };
}

describe("本地SQLite执行存储", () => {
  it("intent幂等创建、账户锁和资金预留原子claim", async () => {
    const path = await tempDbPath();
    const store = await openLocalExecutionStore({ path });
    try {
      const value = intent("SELL");
      expect((await store.createIntent(value)).created).toBe(true);
      expect((await store.createIntent(value)).created).toBe(false);
      await expect(store.claimIntent({
        intentId: value.intentId,
        availableAsset: "BTC",
        availableAmount: "1",
        snapshotAt: NOW - 60_001,
        now: NOW,
        leaseMs: 30_000,
      })).rejects.toThrow("已过期");
      const claim = await store.claimIntent({
        intentId: value.intentId,
        availableAsset: "BTC",
        availableAmount: "1",
        snapshotAt: NOW,
        now: NOW,
        leaseMs: 30_000,
      });
      expect(claim?.intent.state).toBe("reserved");
      expect(claim?.lease.attempt).toBe(1);
      expect(claim?.reservedAmount).toBe("0.05");
      const second = intent("SELL", {
        intentId: "v33:ETH:takeProfit:2026W47",
        strategyEventId: "ETH:takeProfit:2026W47",
        symbol: "ETHUSDT",
      });
      await store.createIntent(second);
      await expect(store.claimIntent({
        intentId: second.intentId,
        availableAsset: "ETH",
        availableAmount: "10",
        snapshotAt: NOW,
        now: NOW,
        leaseMs: 30_000,
      })).resolves.toBeNull();
    } finally {
      store.close();
    }
  });

  it("进程关闭重开后恢复unknown订单、原clientOrderId、账户租约和对账任务", async () => {
    const path = await tempDbPath();
    const first = await openLocalExecutionStore({ path });
    const value = intent("SELL");
    let originalClientOrderId = "";
    let originalLeaseToken = "";
    try {
      const created = await first.createIntent(value);
      expect(created.created).toBe(true);
      const claim = await first.claimIntent({
        intentId: value.intentId,
        availableAsset: "BTC",
        availableAmount: "1",
        snapshotAt: NOW,
        now: NOW,
        leaseMs: 30_000,
      });
      expect(claim).not.toBeNull();
      originalClientOrderId = claim!.intent.clientOrderId!;
      originalLeaseToken = claim!.lease.token;
      await first.markSubmitting({
        intentId: value.intentId, attempt: claim!.lease.attempt,
        leaseToken: claim!.lease.token, clientOrderId: originalClientOrderId, now: NOW + 1,
      });
      await first.markUnknown({
        intentId: value.intentId, attempt: claim!.lease.attempt,
        leaseToken: claim!.lease.token, reason: "模拟进程退出前POST结果未知", now: NOW + 2,
      });
    } finally {
      first.close();
    }

    const restarted = await openLocalExecutionStore({ path });
    try {
      const recovered = await restarted.getIntent(value.intentId);
      expect(recovered?.state).toBe("unknown");
      expect(recovered?.clientOrderId).toBe(originalClientOrderId);
      const context = await restarted.getReconcileContext(value.intentId);
      expect(context?.lease?.token).toBe(originalLeaseToken);
      expect(context?.reservedAsset).toBe("BTC");
      expect(context?.reservedAmount).toBe("0.05");
      const tasks = await restarted.scheduler.claimDue({
        now: NOW + 5_001, leaseMs: 30_000, limit: 5, taskType: "reconcile_intent",
      });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.taskId).toBe(`reconcile:${value.intentId}`);
    } finally {
      restarted.close();
    }
  });

  it("过期账户租约只能接管对账，旧token不能再续租或提交", async () => {
    const store = await openLocalExecutionStore({ path: await tempDbPath() });
    try {
      const value = intent("SELL");
      const { claim, lease } = await claimAndSubmit(store, value);
      await expect(store.renewExecutionLease({
        intentId: value.intentId,
        attempt: claim.lease.attempt,
        leaseToken: claim.lease.token,
        now: NOW + 30_002,
      }, 30_000)).resolves.toBe(false);
      await expect(store.markSubmitting({
        intentId: value.intentId,
        attempt: claim.lease.attempt,
        leaseToken: claim.lease.token,
        clientOrderId: claim.intent.clientOrderId!,
        now: NOW + 30_003,
      })).rejects.toThrow("租约");
      const context = await store.getReconcileContext(value.intentId);
      expect(context?.intent.state).toBe("reconciling");
      expect(context?.lease?.token).toBe(lease.token);
      expect(context?.lease?.token).not.toBe(claim.lease.token);
    } finally {
      store.close();
    }
  });

  it("终态结算原子写入fill、台账、Outbox并释放reservation/账户锁", async () => {
    const path = await tempDbPath();
    const store = await openLocalExecutionStore({ path });
    const value = intent("SELL");
    try {
      const { claim, lease } = await claimAndSubmit(store, value);
      const terminalAt = NOW + 31_000;
      const finalized = await store.finalizeReconciledOrder({
        intentId: value.intentId,
        attempt: claim.lease.attempt,
        leaseToken: lease.token,
        now: NOW + 31_100,
        exchangeOrderId: "12345",
        exchangeStatus: "FILLED",
        executedQty: "0.05",
        cumulativeQuoteQty: "5",
        exchangeTerminalAt: terminalAt,
        fills: [{
          tradeId: "90001", orderId: "12345", price: "100", qty: "0.05",
          quoteQty: "5", commission: "0.01", commissionAsset: "USDT",
          filledAt: terminalAt - 1,
        }],
      });
      expect(finalized.state).toBe("filled");
      expect(finalized.exchangeOrderId).toBe("12345");
    } finally {
      store.close();
    }
    const db = await openLocalExecutionDatabase({ path });
    try {
      expect((db.prepare("SELECT COUNT(*) AS total FROM fills").get() as { total: number }).total).toBe(1);
      expect((db.prepare("SELECT COUNT(*) AS total FROM trade_ledger").get() as { total: number }).total).toBe(1);
      expect((db.prepare("SELECT COUNT(*) AS total FROM notification_outbox").get() as { total: number }).total).toBe(1);
      expect((db.prepare("SELECT COUNT(*) AS total FROM account_lock").get() as { total: number }).total).toBe(0);
      const reservation = db.prepare("SELECT state, consumed_amount FROM reservations").get() as {
        state: string; consumed_amount: string;
      };
      expect(reservation).toEqual({ state: "settled", consumed_amount: "0.05" });
      const ledger = db.prepare("SELECT sell_kind FROM trade_ledger").get() as { sell_kind: string };
      expect(ledger.sell_kind).toBe("take_profit");
    } finally {
      db.close();
    }
  });

  it("终态结算必须持有对应reconcile scheduler lease fencing token", async () => {
    const store = await openLocalExecutionStore({ path: await tempDbPath() });
    const value = intent("SELL");
    try {
      const { claim, lease } = await claimAndSubmit(store, value);
      const [task] = await store.scheduler.claimDue({
        now: NOW + 5_001, leaseMs: 30_000, limit: 1, taskType: "reconcile_intent",
      });
      expect(task).toBeDefined();
      const input = {
        intentId: value.intentId,
        attempt: claim.lease.attempt,
        leaseToken: lease.token,
        now: NOW + 31_100,
        exchangeOrderId: "12350",
        exchangeStatus: "FILLED" as const,
        executedQty: "0.05",
        cumulativeQuoteQty: "5",
        exchangeTerminalAt: NOW + 31_000,
        fills: [{
          tradeId: "90004", orderId: "12350", price: "100", qty: "0.05",
          quoteQty: "5", commission: "0", commissionAsset: "USDT",
          filledAt: NOW + 30_999,
        }],
      };
      await expect(store.finalizeReconciledOrder({
        ...input,
        schedulerLease: { ...task!, leaseToken: "stale-scheduler-token" },
      })).rejects.toThrow("fencing token");
      const stillOpen = await store.getIntent(value.intentId);
      expect(stillOpen?.state).toBe("reconciling");
      await expect(store.finalizeReconciledOrder({
        ...input,
        schedulerLease: task!,
      })).resolves.toMatchObject({ state: "filled" });
    } finally {
      store.close();
    }
  });

  it("超出reservation时fill写入、台账、Outbox和释放操作全部回滚", async () => {
    const path = await tempDbPath();
    const store = await openLocalExecutionStore({ path });
    const value = intent("SELL");
    const { claim, lease } = await claimAndSubmit(store, value);
    try {
      await expect(store.finalizeReconciledOrder({
        intentId: value.intentId,
        attempt: claim.lease.attempt,
        leaseToken: lease.token,
        now: NOW + 31_100,
        exchangeOrderId: "12346",
        exchangeStatus: "FILLED",
        executedQty: "0.05",
        cumulativeQuoteQty: "5",
        exchangeTerminalAt: NOW + 31_000,
        fills: [{
          tradeId: "90002", orderId: "12346", price: "100", qty: "0.05",
          quoteQty: "5", commission: "0.001", commissionAsset: "BTC",
          filledAt: NOW + 30_999,
        }],
      })).rejects.toThrow("超过资金预留");
    } finally {
      store.close();
    }
    const db = await openLocalExecutionDatabase({ path });
    try {
      expect((db.prepare("SELECT COUNT(*) AS total FROM fills").get() as { total: number }).total).toBe(0);
      expect((db.prepare("SELECT COUNT(*) AS total FROM trade_ledger").get() as { total: number }).total).toBe(0);
      expect((db.prepare("SELECT COUNT(*) AS total FROM notification_outbox").get() as { total: number }).total).toBe(0);
      expect((db.prepare("SELECT COUNT(*) AS total FROM account_lock").get() as { total: number }).total).toBe(1);
      expect((db.prepare("SELECT state FROM reservations").get() as { state: string }).state).toBe("reserved");
      expect((db.prepare("SELECT state FROM order_intents").get() as { state: string }).state).toBe("reconciling");
    } finally {
      db.close();
    }
  });

  it("BUY结算保留信号时的baseRatioAtBuy供持仓回放", async () => {
    const path = await tempDbPath();
    const store = await openLocalExecutionStore({ path });
    const value = intent("BUY");
    try {
      const created = await store.createIntent(value);
      expect(created.created).toBe(true);
      const claim = await store.claimIntent({
        intentId: value.intentId, availableAsset: "USDT", availableAmount: "100",
        snapshotAt: NOW, now: NOW, leaseMs: 30_000,
      });
      expect(claim).not.toBeNull();
      await store.markSubmitting({
        intentId: value.intentId, attempt: claim!.lease.attempt,
        leaseToken: claim!.lease.token, clientOrderId: claim!.intent.clientOrderId!, now: NOW + 1,
      });
      await store.markUnknown({
        intentId: value.intentId, attempt: claim!.lease.attempt,
        leaseToken: claim!.lease.token, reason: "测试恢复", now: NOW + 2,
      });
      const lease = await store.takeoverForReconciliation({
        intentId: value.intentId, attempt: claim!.lease.attempt,
        leaseToken: claim!.lease.token, now: NOW + 30_001,
      }, 30_000);
      expect(lease).not.toBeNull();
      await store.finalizeReconciledOrder({
        intentId: value.intentId, attempt: claim!.lease.attempt,
        leaseToken: lease!.token, now: NOW + 31_100,
        exchangeOrderId: "12347", exchangeStatus: "FILLED",
        executedQty: "0.1", cumulativeQuoteQty: "9.99",
        exchangeTerminalAt: NOW + 31_000,
        fills: [{
          tradeId: "90003", orderId: "12347", price: "99.9", qty: "0.1",
          quoteQty: "9.99", commission: "0.01", commissionAsset: "USDT",
          filledAt: NOW + 30_999,
        }],
      });
    } finally {
      store.close();
    }
    const db = await openLocalExecutionDatabase({ path });
    try {
      const row = db.prepare("SELECT base_ratio_at_buy FROM trade_ledger").get() as { base_ratio_at_buy: number };
      expect(row.base_ratio_at_buy).toBe(0.7);
    } finally {
      db.close();
    }
  });

  it("scheduler并发claim互斥、ack幂等、过期lease退避", async () => {
    const store = await openLocalExecutionStore({ path: await tempDbPath() });
    try {
      await store.scheduler.enqueue({
        taskId: "reconcile:v33:BTC:takeProfit:2026W47",
        taskType: "reconcile_intent",
        dueAt: NOW,
      }, NOW);
      const [first, second] = await Promise.all([
        store.scheduler.claimDue({ now: NOW, leaseMs: 30_000, limit: 1 }),
        store.scheduler.claimDue({ now: NOW, leaseMs: 30_000, limit: 1 }),
      ]);
      expect(first.length + second.length).toBe(1);
      const lease = first[0] ?? second[0]!;
      expect(await store.scheduler.ack(lease, NOW + 1)).toBe(true);
      expect(await store.scheduler.ack(lease, NOW + 2)).toBe(true);

      await store.scheduler.enqueue({
        taskId: "reconcile:v33:ETH:takeProfit:2026W47",
        taskType: "reconcile_intent",
        dueAt: NOW,
      }, NOW);
      const [expired] = await store.scheduler.claimDue({ now: NOW, leaseMs: 1_000, limit: 1 });
      expect(expired).toBeDefined();
      expect(await store.scheduler.recoverExpired(NOW + 1_001)).toBe(1);
      const retry = await store.scheduler.claimDue({ now: NOW + 1_001, leaseMs: 30_000, limit: 1 });
      expect(retry).toHaveLength(0);
      const db = await openLocalExecutionDatabase({ path: (store as unknown as { database: { path: string } }).database.path });
      try {
        const task = db.prepare("SELECT state, attempt FROM scheduler_tasks WHERE task_id = ?")
          .get("reconcile:v33:ETH:takeProfit:2026W47") as { state: string; attempt: number };
        expect(task.state).toBe("pending");
        expect(task.attempt).toBe(1);
      } finally {
        db.close();
      }
    } finally {
      store.close();
    }
  });

  it("scheduler重试耗尽时将订单和reservation一起转manual_review并保留账户锁", async () => {
    const path = await tempDbPath();
    const store = await openLocalExecutionStore({ path });
    const value = intent("SELL");
    try {
      const created = await store.createIntent(value);
      expect(created.created).toBe(true);
      const claim = await store.claimIntent({
        intentId: value.intentId, availableAsset: "BTC", availableAmount: "1",
        snapshotAt: NOW, now: NOW, leaseMs: 30_000,
      });
      expect(claim).not.toBeNull();
      await store.markSubmitting({
        intentId: value.intentId, attempt: claim!.lease.attempt,
        leaseToken: claim!.lease.token, clientOrderId: claim!.intent.clientOrderId!, now: NOW + 1,
      });
      await store.markUnknown({
        intentId: value.intentId, attempt: claim!.lease.attempt,
        leaseToken: claim!.lease.token, reason: "unknown", now: NOW + 2,
      });

      let clock = NOW + 5_001;
      for (let attempt = 1; attempt <= 8; attempt += 1) {
        const [task] = await store.scheduler.claimDue({ now: clock, leaseMs: 30_000, limit: 1 });
        expect(task?.attempt).toBe(attempt);
        const result = await store.scheduler.retry(task!, clock, "测试对账持续未知");
        if (attempt < 8) {
          expect(result).toBe("pending");
          clock = schedulerTaskRetryAt(attempt, clock)!;
        } else {
          expect(result).toBe("manual_review");
        }
      }
      expect((await store.getIntent(value.intentId))?.state).toBe("manual_review");
    } finally {
      store.close();
    }
    const db = await openLocalExecutionDatabase({ path });
    try {
      expect((db.prepare("SELECT state FROM reservations").get() as { state: string }).state).toBe("manual_review");
      expect((db.prepare("SELECT COUNT(*) AS total FROM account_lock").get() as { total: number }).total).toBe(1);
      expect((db.prepare("SELECT state FROM scheduler_tasks").get() as { state: string }).state).toBe("manual_review");
    } finally {
      db.close();
    }
  });

  it("SELL事件幂等、提交claim和订单绑定均持久化", async () => {
    const store = await openLocalExecutionStore({ path: await tempDbPath() });
    try {
      const event: SellEventRecord = {
        eventKey: "sell:BTC:take_profit:2:止盈1",
        symbol: "BTC",
        kind: "take_profit",
        status: "pending",
        requestedQty: 0.05,
        createdAt: NOW,
        updatedAt: NOW,
        exchangeOrderId: null,
        fillIds: [],
        lastError: null,
      };
      expect((await store.sellEvents.reserveSellEvent(event)).created).toBe(true);
      expect((await store.sellEvents.reserveSellEvent(event)).created).toBe(false);
      const claimed = await store.sellEvents.claimSellEventForSubmission(event.eventKey, "gpt-sell-1", NOW + 1);
      expect(claimed.status).toBe("reconcile_required");
      expect(claimed.clientOrderId).toBe("gpt-sell-1");
      await expect(store.sellEvents.claimSellEventForSubmission(event.eventKey, "gpt-sell-2", NOW + 2))
        .rejects.toThrow("禁止重复提交");
      const bound = await store.sellEvents.bindSellEventToExchangeOrder(event.eventKey, "12348", NOW + 3);
      expect(bound.exchangeOrderId).toBe("12348");
    } finally {
      store.close();
    }
  });

  it("SELL成交fill、台账和Outbox幂等写入", async () => {
    const store = await openLocalExecutionStore({ path: await tempDbPath() });
    try {
      const fill: ExecutionFill = {
        fillId: "99001", orderId: "12349", symbol: "BTCUSDT", side: "SELL",
        time: NOW, price: 100, qty: 0.05, quoteQty: 5,
        commission: 0.01, commissionAsset: "USDT", commissionUsdt: 0.01,
      };
      expect((await store.tradeLedger.recordConfirmedSellFill(fill, "take_profit")).recorded).toBe(true);
      expect((await store.tradeLedger.recordConfirmedSellFill(fill, "take_profit")).recorded).toBe(false);
      await expect(store.tradeLedger.recordConfirmedSellFill(fill, "base_reduce"))
        .rejects.toThrow("不同内容或卖出分类");
      expect(await store.tradeLedger.listTradeLedger()).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});
  it("SQLite文件重开后Trader只查询unknown订单的原clientOrderId且绝不再次POST", async () => {
    const path = await tempDbPath();
    const value = intent("BUY");
    let originalClientOrderId = "";
    const first = await openLocalExecutionStore({ path });
    try {
      await first.createIntent(value);
      const claim = await first.claimIntent({
        intentId: value.intentId,
        availableAsset: "USDT",
        availableAmount: "100",
        snapshotAt: NOW,
        now: NOW,
        leaseMs: 30_000,
      });
      expect(claim).not.toBeNull();
      originalClientOrderId = claim!.intent.clientOrderId!;
      await first.markSubmitting({
        intentId: value.intentId,
        attempt: claim!.lease.attempt,
        leaseToken: claim!.lease.token,
        clientOrderId: originalClientOrderId,
        now: NOW + 1,
      });
      await first.markUnknown({
        intentId: value.intentId,
        attempt: claim!.lease.attempt,
        leaseToken: claim!.lease.token,
        reason: "模拟下单请求发出后进程退出，响应未知",
        now: NOW + 2,
      });
    } finally {
      first.close();
    }

    // 模拟Trader重新启动：重新打开同一个真实SQLite文件，再运行正式循环。
    const restarted = await openLocalExecutionStore({ path });
    const findOrderByClientOrderId = vi.fn(async (symbol: string, clientOrderId: string) => {
      return { kind: "not_found" as const };
    });
    const submitOrder = vi.fn(async () => {
      throw new Error("测试失败：unknown恢复路径不允许再次POST");
    });
    try {
      const result = await runTraderCycle({
        mode: "off",
        store: restarted,
        getDashboard: vi.fn(async () => { throw new Error("off模式不得读取新信号"); }),
        adapter: {
          findOrderByClientOrderId,
          listOrderTrades: vi.fn(),
          getAccountBalances: vi.fn(),
          getSymbolRules: vi.fn(),
        } as never,
        submitOrder,
        now: () => NOW + 5_001,
      });
      expect(result.mode).toBe("off");
      expect(findOrderByClientOrderId).toHaveBeenCalledTimes(1);
      expect(findOrderByClientOrderId).toHaveBeenCalledWith("BTCUSDT", originalClientOrderId);
      expect(submitOrder).not.toHaveBeenCalled();
      const recovered = await restarted.getIntent(value.intentId);
      expect(recovered?.state).toBe("unknown");
      expect(recovered?.clientOrderId).toBe(originalClientOrderId);
    } finally {
      restarted.close();
    }
  });

