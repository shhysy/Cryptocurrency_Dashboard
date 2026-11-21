import "fake-indexeddb/auto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  claimTradeNotificationOutboxBatch,
  markTradeNotificationFailed,
  markTradeNotificationSent,
  recordConfirmedSellFill,
} from "./store.browser";
import type { ExecutionFill } from "./types";

const DB_NAME = "long-term-investment-execution";

function deleteExecutionDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("删除测试 IndexedDB 失败"));
    request.onblocked = () => reject(new Error("测试 IndexedDB 删除被阻塞"));
  });
}

function sellFill(id: string): ExecutionFill {
  return {
    fillId: id,
    orderId: `ord-${id}`,
    symbol: "BTCUSDT",
    side: "SELL",
    time: 1_700_000_000_000,
    price: 60000,
    qty: 0.05,
    quoteQty: 3000,
    commission: 0.01,
    commissionAsset: "USDT",
    commissionUsdt: 0.01,
  };
}

describe("Outbox IndexedDB 租约与崩溃恢复", () => {
  beforeEach(async () => {
    await deleteExecutionDatabase();
  });

  afterAll(async () => {
    await deleteExecutionDatabase();
  });

  it("成交入账后可被 claim；同批第二次 claim 为空", async () => {
    await recordConfirmedSellFill(sellFill("o1"), "take_profit");
    const first = await claimTradeNotificationOutboxBatch(10, 1000, 60_000);
    expect(first.length).toBe(1);
    expect(first[0].status).toBe("sending");
    expect(first[0].leaseToken).toBeTruthy();
    const second = await claimTradeNotificationOutboxBatch(10, 1000, 60_000);
    expect(second.length).toBe(0);
  });

  it("租约过期后可被新调度器接管；旧 token 不能 mark sent", async () => {
    await recordConfirmedSellFill(sellFill("o2"), "take_profit");
    const [old] = await claimTradeNotificationOutboxBatch(10, 1_000, 10_000);
    expect(old.leaseToken).toBeTruthy();
    const [neu] = await claimTradeNotificationOutboxBatch(10, 12_000, 60_000);
    expect(neu.leaseToken).not.toBe(old.leaseToken);
    await expect(markTradeNotificationSent(old.id, old.leaseToken!, 12_001)).rejects.toThrow(/租约/);
    await markTradeNotificationSent(neu.id, neu.leaseToken!, 12_001);
  });

  it("旧调度器 mark failed 在被接管后失败；新持有者可 failed 后退避再领", async () => {
    await recordConfirmedSellFill(sellFill("o3"), "take_profit");
    const [old] = await claimTradeNotificationOutboxBatch(10, 1_000, 10_000);
    const [neu] = await claimTradeNotificationOutboxBatch(10, 12_000, 60_000);
    await expect(markTradeNotificationFailed(old.id, old.leaseToken!, "timeout", 12_001)).rejects.toThrow(/租约/);
    await markTradeNotificationFailed(neu.id, neu.leaseToken!, "worker 503", 12_001);
    const mid = await claimTradeNotificationOutboxBatch(10, 12_001, 60_000);
    expect(mid.length).toBe(0);
  });
});
