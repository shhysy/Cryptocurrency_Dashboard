import "fake-indexeddb/auto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { recordConfirmedSellFill } from "./store.browser";
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

function sellFill(over: Partial<ExecutionFill> = {}): ExecutionFill {
  return {
    fillId: "persist-f1",
    orderId: "ord-1",
    symbol: "BTCUSDT",
    side: "SELL",
    time: 1_700_000_000_000,
    price: 60000,
    qty: 0.05,
    quoteQty: 3000,
    commission: 0.01,
    commissionAsset: "USDT",
    commissionUsdt: 0.01,
    ...over,
  };
}

describe("recordConfirmedSellFill 唯一键冲突", () => {
  beforeEach(async () => {
    await deleteExecutionDatabase();
  });

  afterAll(async () => {
    await deleteExecutionDatabase();
  });

  it("同 fill 幂等重放（相同 sellKind）不抛错", async () => {
    const fill = sellFill();
    const first = await recordConfirmedSellFill(fill, "take_profit");
    expect(first.recorded).toBe(true);
    const second = await recordConfirmedSellFill(fill, "take_profit");
    expect(second.recorded).toBe(false);
  });

  it("同 fillId 改写 sellKind 必须失败（持久化冲突）", async () => {
    const fill = sellFill();
    await recordConfirmedSellFill(fill, "take_profit");
    await expect(recordConfirmedSellFill(fill, "base_reduce")).rejects.toThrow(/卖出分类|冲突/);
  });

  it("同 fillId 改写 qty 必须失败", async () => {
    const fill = sellFill();
    await recordConfirmedSellFill(fill, "take_profit");
    await expect(recordConfirmedSellFill(sellFill({ qty: 0.06, quoteQty: 3600 }), "take_profit")).rejects.toThrow();
  });

  it("极大 commission 仍只存 qty 字段，不与 qty 混淆", async () => {
    const fill = sellFill({ commission: 999, commissionUsdt: 999 });
    const { ledger } = await recordConfirmedSellFill(fill, "take_profit");
    expect(ledger.qty).toBe(0.05);
    expect(ledger.commission).toBe(999);
    expect(ledger.sellKind).toBe("take_profit");
  });
});
