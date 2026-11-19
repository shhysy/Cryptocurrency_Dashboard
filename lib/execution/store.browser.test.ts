import "fake-indexeddb/auto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueuedBuy } from "./queue";
import {
  applyConfirmedBuyReservationSpend,
  claimBuyOrderSubmission,
  enqueueBuyOrder,
  listBuyFundsReservations,
  listBuyOrders,
  reserveBuyFunds,
  saveBuyOrder,
  topUpBuyFundsReservationAfterEarnCredit,
} from "./store.browser";
import type { BuyOrderIntent } from "./types";

const DB_NAME = "long-term-investment-execution";

function deleteExecutionDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("删除测试 IndexedDB 失败"));
    request.onblocked = () => reject(new Error("测试 IndexedDB 删除被阻塞"));
  });
}

function makeOrder(eventKey: string, now = 1) {
  const intent: BuyOrderIntent = {
    eventKey,
    symbol: "BTC",
    quoteAsset: "USDT",
    strategyLabel: "测试补仓",
    plannedUsdt: 100,
    referencePrice: 50000,
    baseRatioAtSignal: 0.4,
    createdAt: now,
    strategyVersion: "V3.3",
  };
  return createQueuedBuy(intent, now);
}

describe("IndexedDB BUY reservation and claim integration", () => {
  beforeEach(async () => {
    if (typeof indexedDB === "undefined") {
      throw new Error("Node 22 IndexedDB is required for these integration tests");
    }
    await deleteExecutionDatabase();
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  afterAll(async () => {
    if (typeof indexedDB !== "undefined") await deleteExecutionDatabase();
  });

  it("serializes concurrent reservations for different orders against one balance snapshot", async () => {
    await Promise.all([
      enqueueBuyOrder(makeOrder("BTC:add:week-a", 1)),
      enqueueBuyOrder(makeOrder("BTC:add:week-b", 2)),
    ]);

    const [first, second] = await Promise.all([
      reserveBuyFunds({
        orderId: "v33-BTC%3Aadd%3Aweek-a",
        symbol: "BTCUSDT",
        requestedUsdt: 80,
        observedFreeUsdt: 100,
        minNotionalUsdt: 5,
        now: 10,
      }),
      reserveBuyFunds({
        orderId: "v33-BTC%3Aadd%3Aweek-b",
        symbol: "BTCUSDT",
        requestedUsdt: 80,
        observedFreeUsdt: 100,
        minNotionalUsdt: 5,
        now: 11,
      }),
    ]);

    expect(first.plan.ok).toBe(true);
    expect(second.plan.ok).toBe(true);
    const reservations = await listBuyFundsReservations();
    expect(reservations).toHaveLength(2);
    expect(reservations.reduce((sum, item) => sum + item.reservedUsdt, 0)).toBeCloseTo(100, 8);
    expect(reservations.every((item) => item.status === "active")).toBe(true);
  });

  it("keeps concurrent reserve calls for one order idempotent", async () => {
    const order = makeOrder("BTC:add:week-same");
    await enqueueBuyOrder(order);

    const [a, b] = await Promise.all([
      reserveBuyFunds({
        orderId: order.id, symbol: "BTCUSDT", requestedUsdt: 50,
        observedFreeUsdt: 100, minNotionalUsdt: 5, now: 20,
      }),
      reserveBuyFunds({
        orderId: order.id, symbol: "BTCUSDT", requestedUsdt: 70,
        observedFreeUsdt: 100, minNotionalUsdt: 5, now: 21,
      }),
    ]);

    expect(a.plan.ok).toBe(true);
    expect(b.plan.ok).toBe(true);
    expect(a.reservation?.reservedUsdt).toBe(b.reservation?.reservedUsdt);
    expect(await listBuyFundsReservations()).toHaveLength(1);
  });

  it("allows only one concurrent tab to claim the same BUY attempt", async () => {
    const order = makeOrder("BTC:add:week-claim");
    await enqueueBuyOrder(order);

    const results = await Promise.allSettled([
      claimBuyOrderSubmission(order.id, 30),
      claimBuyOrderSubmission(order.id, 31),
    ]);

    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
    const [saved] = await listBuyOrders();
    expect(saved.status).toBe("reconcile_required");
    expect(saved.attemptCount).toBe(1);
  });

  it("extends only the current order reservation after a verified Earn credit", async () => {
    const order = makeOrder("BTC:add:week-earn");
    await enqueueBuyOrder(order);
    await reserveBuyFunds({
      orderId: order.id, symbol: "BTCUSDT", requestedUsdt: 30,
      observedFreeUsdt: 30, minNotionalUsdt: 5, now: 50,
    });

    const updated = await topUpBuyFundsReservationAfterEarnCredit({
      orderId: order.id,
      symbol: "BTCUSDT",
      requestedRemainingUsdt: 100,
      observedFreeUsdt: 100,
      expectedAttemptCount: order.attemptCount,
      expectedOrderUpdatedAt: order.updatedAt,
      now: 51,
    });
    expect(updated).toMatchObject({
      reservedUsdt: 100,
      originalReservedUsdt: 100,
      consumedUsdt: 0,
      status: "active",
    });
  });

  it("starts a fresh reservation spend baseline for a new attempt after a partial terminal fill", async () => {
    const order = makeOrder("BTC:add:week-next-attempt");
    await enqueueBuyOrder(order);
    await reserveBuyFunds({
      orderId: order.id, symbol: "BTCUSDT", requestedUsdt: 100,
      observedFreeUsdt: 100, minNotionalUsdt: 5, now: 60,
    });
    const claimed = await claimBuyOrderSubmission(order.id, 61);
    await applyConfirmedBuyReservationSpend(order.id, 70, true, claimed.attempt, 62);
    const partial = {
      ...claimed.order,
      status: "partially_filled" as const,
      filledUsdt: 70,
      remainingUsdt: 30,
      updatedAt: 63,
      lastError: null,
    };
    await saveBuyOrder(partial);

    const nextAttemptReservation = await topUpBuyFundsReservationAfterEarnCredit({
      orderId: order.id,
      symbol: "BTCUSDT",
      requestedRemainingUsdt: 30,
      observedFreeUsdt: 100,
      expectedAttemptCount: partial.attemptCount,
      expectedOrderUpdatedAt: partial.updatedAt,
      now: 64,
    });
    expect(nextAttemptReservation).toMatchObject({
      reservedUsdt: 30,
      originalReservedUsdt: 30,
      consumedUsdt: 0,
      status: "active",
    });
  });

  it("rejects an Earn top-up when the queued order changed after the caller read it", async () => {
    const order = makeOrder("BTC:add:week-earn-stale");
    await enqueueBuyOrder(order);
    await saveBuyOrder({ ...order, updatedAt: order.updatedAt + 1 });

    await expect(topUpBuyFundsReservationAfterEarnCredit({
      orderId: order.id,
      symbol: "BTCUSDT",
      requestedRemainingUsdt: 100,
      observedFreeUsdt: 100,
      expectedAttemptCount: order.attemptCount,
      expectedOrderUpdatedAt: order.updatedAt,
    })).rejects.toThrow("已变化");
    expect(await listBuyFundsReservations()).toHaveLength(0);
  });

  it("reopens the database connection and recovers persisted queue state", async () => {
    const order = makeOrder("BTC:add:week-reopen");
    await enqueueBuyOrder(order);

    // Every store operation closes its connection; this second read opens a
    // fresh connection, matching a page reload's persistence boundary.
    const recovered = await listBuyOrders();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      id: order.id,
      status: "pending",
      remainingUsdt: 100,
      attemptCount: 0,
    });
  });

  it("fails closed if an order changes state before funds are reserved", async () => {
    const order = makeOrder("BTC:add:week-stale");
    await enqueueBuyOrder({ ...order, status: "reconcile_required" });

    await expect(reserveBuyFunds({
      orderId: order.id,
      symbol: "BTCUSDT",
      requestedUsdt: 50,
      observedFreeUsdt: 100,
      minNotionalUsdt: 5,
    })).rejects.toThrow("禁止新建或扩展资金预留");
    expect(await listBuyFundsReservations()).toHaveLength(0);
  });

  it("fails closed when a legacy tab blocks an IndexedDB schema upgrade", async () => {
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 3);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("legacy", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("打开旧版本测试数据库失败"));
    });

    try {
      await expect(listBuyOrders()).rejects.toThrow("升级被其他浏览器标签页阻塞");
    } finally {
      blocker.close();
      // Let the already-rejected upgrade request finish and close its
      // connection after the blocking legacy tab releases the version lock.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });

  it("fails closed when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(listBuyOrders()).rejects.toThrow("当前环境不支持 IndexedDB");
  });

  it("does not claim an order twice after the first claim is persisted", async () => {
    const order = makeOrder("BTC:add:week-repeat");
    await enqueueBuyOrder(order);
    const first = await claimBuyOrderSubmission(order.id, 40);
    expect(first.attempt).toBe(0);
    await expect(claimBuyOrderSubmission(order.id, 41)).rejects.toThrow("禁止重复提交");
    expect((await listBuyOrders())[0].attemptCount).toBe(1);
  });
});
