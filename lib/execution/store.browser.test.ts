import "fake-indexeddb/auto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createQueuedBuy } from "./queue";
import {
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

  it("does not claim an order twice after the first claim is persisted", async () => {
    const order = makeOrder("BTC:add:week-repeat");
    await enqueueBuyOrder(order);
    const first = await claimBuyOrderSubmission(order.id, 40);
    expect(first.attempt).toBe(0);
    await expect(claimBuyOrderSubmission(order.id, 41)).rejects.toThrow("禁止重复提交");
    expect((await listBuyOrders())[0].attemptCount).toBe(1);
  });
});
