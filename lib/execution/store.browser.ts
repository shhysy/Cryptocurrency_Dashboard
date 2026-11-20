import type { ExecutionFill, QueuedBuyOrder, TradeLedgerEntry } from "./types";
import { isCurrentBuyAttempt } from "./buy-attempt";
import { assertDuplicateExecutionFillMatches } from "./fill-reconcile";
import { applyConfirmedBuyFill } from "./queue";
import { buyOrderReservationBlockReason, planBuyFundsReservation, planBuyFundsReservationTopUp, reconcileBuyFundsReservation, type BuyFundsReservation } from "./fund-reservation";
import { buildTradeFillNotificationEvent, isTradeNotificationClaimable, type TradeNotificationOutboxEvent } from "./notification-outbox";
import { transitionEarnRedemption, type EarnRedemptionIntent, type EarnRedemptionStatus } from "./earn-redemption";

const DB_NAME = "long-term-investment-execution";
const DB_VERSION = 4;
const ORDERS = "buy-orders";
const FILLS = "fills";
const LEDGER = "trade-ledger";
const RESERVATIONS = "buy-funds-reservations";
const NOTIFICATION_OUTBOX = "notification-outbox";
const EARN_REDEMPTIONS = "earn-redemption-intents";

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("当前环境不支持 IndexedDB"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ORDERS)) db.createObjectStore(ORDERS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(FILLS)) db.createObjectStore(FILLS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(LEDGER)) db.createObjectStore(LEDGER, { keyPath: "id" });
      if (!db.objectStoreNames.contains(RESERVATIONS)) db.createObjectStore(RESERVATIONS, { keyPath: "orderId" });
      if (!db.objectStoreNames.contains(NOTIFICATION_OUTBOX)) db.createObjectStore(NOTIFICATION_OUTBOX, { keyPath: "id" });
      if (!db.objectStoreNames.contains(EARN_REDEMPTIONS)) db.createObjectStore(EARN_REDEMPTIONS, { keyPath: "id" });
    };
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(new Error("执行数据库升级被其他浏览器标签页阻塞；请关闭旧标签页后重试"));
    };
    request.onsuccess = () => {
      const db = request.result;
      // Release old-version connections promptly so a future schema upgrade
      // cannot remain blocked by a dormant dashboard tab.
      db.onversionchange = () => db.close();
      if (blocked) {
        db.close();
        return;
      }
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("打开执行数据库失败"));
  });
}

function fillKey(fill: Pick<ExecutionFill, "symbol" | "fillId">) {
  return `${fill.symbol}:${fill.fillId}`;
}

export async function listBuyOrders(): Promise<QueuedBuyOrder[]> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(ORDERS, "readonly");
      const request = tx.objectStore(ORDERS).getAll();
      request.onsuccess = () => resolve((request.result as QueuedBuyOrder[]).sort((a, b) => a.createdAt - b.createdAt));
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

/** Atomic add-if-absent across tabs. Repeated signal refreshes return the existing order. */
export async function enqueueBuyOrder(order: QueuedBuyOrder): Promise<{ order: QueuedBuyOrder; created: boolean }> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(ORDERS, "readwrite");
      const store = tx.objectStore(ORDERS);
      const get = store.get(order.id);
      let result: { order: QueuedBuyOrder; created: boolean } = { order, created: false };
      get.onsuccess = () => {
        if (get.result) result = { order: get.result as QueuedBuyOrder, created: false };
        else { store.add(order); result = { order, created: true }; }
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error("写入待买队列失败"));
      tx.onabort = () => reject(tx.error ?? new Error("待买队列事务中止"));
    });
  } finally { db.close(); }
}

export async function saveBuyOrder(order: QueuedBuyOrder): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ORDERS, "readwrite");
      tx.objectStore(ORDERS).put(order);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("保存订单失败"));
    });
  } finally { db.close(); }
}

/**
 * Atomically apply one exchange-confirmed BUY fill.
 * The queue read, unique fill claim, cost update and ledger insert share one
 * IndexedDB transaction, so concurrent tabs cannot lose or double-apply fills.
 */
export async function recordConfirmedBuyFill(
  fill: ExecutionFill,
  queuedOrderId: string,
  expectedAttempt?: number,
): Promise<{ recorded: boolean; ledger: TradeLedgerEntry; order: QueuedBuyOrder }> {
  if (fill.side !== "BUY") throw new Error("当前原子记账函数只接受买入成交");
  if (!queuedOrderId || !fill.fillId || !fill.symbol) throw new Error("成交记录或待买订单标识无效");
  const db = await openDb();
  const id = fillKey(fill);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([ORDERS, FILLS, LEDGER, RESERVATIONS, NOTIFICATION_OUTBOX], "readwrite");
      const orders = tx.objectStore(ORDERS);
      const fills = tx.objectStore(FILLS);
      const ledgerStore = tx.objectStore(LEDGER);
      const reservations = tx.objectStore(RESERVATIONS);
      const outbox = tx.objectStore(NOTIFICATION_OUTBOX);
      const getFill = fills.get(id);
      const getLedger = ledgerStore.get(id);
      const getOrder = orders.get(queuedOrderId);
      const getReservation = reservations.get(queuedOrderId);
      let fillReady = false;
      let ledgerReady = false;
      let existingFillRecord: { id: string; fill: ExecutionFill } | undefined;
      let existingLedger: TradeLedgerEntry | undefined;
      let orderReady = false;
      let reservationReady = false;
      let existingFill = false;
      let currentOrder: QueuedBuyOrder | undefined;
      let currentReservation: BuyFundsReservation | undefined;
      let result: { recorded: boolean; ledger: TradeLedgerEntry; order: QueuedBuyOrder } | undefined;
      let fatalError: Error | null = null;

      const finishReads = () => {
        if (!fillReady || !ledgerReady || !orderReady || !reservationReady || result || fatalError) return;
        if (!currentOrder) {
          fatalError = new Error("成交对应的待买订单不存在");
          tx.abort();
          return;
        }
        if (expectedAttempt !== undefined &&
            !isCurrentBuyAttempt(currentOrder, expectedAttempt)) {
          fatalError = new Error("该成交属于过期 attempt；当前买入任务已变化，拒绝修改队列和台账");
          tx.abort();
          return;
        }
        let ledger: TradeLedgerEntry = { ...fill, id, realizedPnlUsdt: null };
        if (existingFill) {
          if (!existingLedger || !existingFillRecord) {
            fatalError = new Error("买入成交去重索引与台账记录不一致，暂停记账");
            tx.abort();
            return;
          }
          try {
            assertDuplicateExecutionFillMatches(existingFillRecord.fill, null, fill, null);
            assertDuplicateExecutionFillMatches(existingLedger, null, fill, null);
            result = { recorded: false, ledger: existingLedger, order: currentOrder };
          } catch (error) {
            fatalError = error instanceof Error ? error : new Error("重复买入成交数据冲突");
            tx.abort();
          }
          return;
        }
        if (existingLedger) {
          fatalError = new Error("买入成交台账存在记录但去重索引缺失，暂停记账");
          tx.abort();
          return;
        }
        try {
          const baseRatioAtBuy = currentOrder.baseRatioAtSignal;
          if (!Number.isFinite(baseRatioAtBuy) || baseRatioAtBuy < 0 || baseRatioAtBuy > 1) {
            throw new Error("待买订单缺少有效的历史底仓比例，旧订单必须人工核对后才能入账");
          }
          ledger = { ...ledger, baseRatioAtBuy };
          const confirmedSpendUsdt = fill.quoteQty + fill.commissionUsdt;
          const updatedOrder = applyConfirmedBuyFill(currentOrder, confirmedSpendUsdt);

          // If this attempt has a local USDT reservation, consume it in the
          // same transaction as the unique fill and queue/ledger update.
          if (currentReservation?.status === "active") {
            const cumulativeSpendUsdt = (currentReservation.consumedUsdt ?? 0) + confirmedSpendUsdt;
            // A fill alone does not prove the exchange order is terminal.
            // Keep the reservation active until the order snapshot is terminal.
            reservations.put(reconcileBuyFundsReservation(
              currentReservation,
              cumulativeSpendUsdt,
              false,
              Date.now(),
            ));
          }

          fills.add({ id, fill });
          ledgerStore.add(ledger);
          orders.put(updatedOrder);
          // The notification is created in the same transaction as the
          // exchange-confirmed fill. Duplicate fill IDs never create a second
          // email event.
          outbox.add(buildTradeFillNotificationEvent(fill));
          result = { recorded: true, ledger, order: updatedOrder };
        } catch (error) {
          fatalError = error instanceof Error ? error : new Error("成交入账失败");
          tx.abort();
        }
      };

      getFill.onsuccess = () => {
        existingFill = Boolean(getFill.result);
        fillReady = true;
        finishReads();
      };
      getLedger.onsuccess = () => {
        existingLedger = getLedger.result as TradeLedgerEntry | undefined;
        ledgerReady = true;
        finishReads();
      };
      getOrder.onsuccess = () => {
        currentOrder = getOrder.result as QueuedBuyOrder | undefined;
        orderReady = true;
        finishReads();
      };
      getReservation.onsuccess = () => {
        currentReservation = getReservation.result as BuyFundsReservation | undefined;
        reservationReady = true;
        finishReads();
      };
      getFill.onerror = () => { fatalError = getFill.error ?? new Error("查询成交 ID 失败"); tx.abort(); };
      getLedger.onerror = () => { fatalError = getLedger.error ?? new Error("查询买入成交台账失败"); tx.abort(); };
      getOrder.onerror = () => { fatalError = getOrder.error ?? new Error("读取待买订单失败"); tx.abort(); };
      getReservation.onerror = () => { fatalError = getReservation.error ?? new Error("读取资金预留失败"); tx.abort(); };
      tx.oncomplete = () => {
        if (result) resolve(result);
        else reject(fatalError ?? new Error("成交事务未生成结果"));
      };
      tx.onerror = () => reject(fatalError ?? tx.error ?? new Error("写入成交台账失败"));
      tx.onabort = () => reject(fatalError ?? tx.error ?? new Error("成交台账事务中止"));
    });
  } finally {
    db.close();
  }
}

/**
 * Atomically persist one exchange-confirmed SELL fill and its notification.
 * SELL fills do not alter the buy queue or buy-cost reservations.
 */
export async function recordConfirmedSellFill(
  fill: ExecutionFill,
  sellKind: NonNullable<TradeLedgerEntry["sellKind"]>,
): Promise<{ recorded: boolean; ledger: TradeLedgerEntry }> {
  if (fill.side !== "SELL") throw new Error("卖出成交记账函数只接受 SELL 成交");
  if (!["take_profit", "indicator_profit", "trail_stop", "base_reduce"].includes(sellKind)) {
    throw new Error("卖出成交缺少有效的周期仓/底仓事件类型");
  }
  if (!fill.fillId || !fill.symbol || !fill.orderId) throw new Error("卖出成交记录缺少交易所标识");
  const db = await openDb();
  const id = fillKey(fill);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([FILLS, LEDGER, NOTIFICATION_OUTBOX], "readwrite");
      const fills = tx.objectStore(FILLS);
      const ledgerStore = tx.objectStore(LEDGER);
      const outbox = tx.objectStore(NOTIFICATION_OUTBOX);
      const getFill = fills.get(id);
      const getLedger = ledgerStore.get(id);
      let result: { recorded: boolean; ledger: TradeLedgerEntry } | undefined;
      let fatal: Error | null = null;
      const finishDuplicateCheck = () => {
        if (getFill.readyState !== "done" || getLedger.readyState !== "done") return;
        const ledger: TradeLedgerEntry = { ...fill, id, realizedPnlUsdt: null, sellKind };
        const existingFillRecord = getFill.result as { id: string; fill: ExecutionFill } | undefined;
        const existingLedger = getLedger.result as TradeLedgerEntry | undefined;
        if (existingFillRecord) {
          if (!existingLedger) {
            fatal = new Error("成交去重索引与台账记录不一致，暂停卖出记账");
            tx.abort();
            return;
          }
          try {
            assertDuplicateExecutionFillMatches(existingFillRecord.fill, existingLedger.sellKind ?? null, fill, sellKind);
            result = { recorded: false, ledger };
          } catch (error) {
            fatal = error instanceof Error ? error : new Error("重复成交数据冲突");
            tx.abort();
          }
          return;
        }
        if (existingLedger) {
          fatal = new Error("成交台账存在记录但去重索引缺失，暂停卖出记账");
          tx.abort();
          return;
        }
        try {
          fills.add({ id, fill });
          ledgerStore.add(ledger);
          outbox.add(buildTradeFillNotificationEvent(fill));
          result = { recorded: true, ledger };
        } catch (error) {
          fatal = error instanceof Error ? error : new Error("卖出成交入账失败");
          tx.abort();
        }
      };
      getFill.onsuccess = finishDuplicateCheck;
      getLedger.onsuccess = finishDuplicateCheck;
      getFill.onerror = () => { fatal = getFill.error ?? new Error("查询卖出成交 ID 失败"); tx.abort(); };
      getLedger.onerror = () => { fatal = getLedger.error ?? new Error("查询卖出台账记录失败"); tx.abort(); };
      tx.oncomplete = () => result ? resolve(result) : reject(fatal ?? new Error("卖出成交事务未生成结果"));
      tx.onerror = () => reject(fatal ?? tx.error ?? new Error("写入卖出成交台账失败"));
      tx.onabort = () => reject(fatal ?? tx.error ?? new Error("卖出成交台账事务中止"));
    });
  } finally {
    db.close();
  }
}

/** Atomically mark the latest persisted queue row for manual reconciliation. */
export async function markBuyOrderReconcileRequired(
  orderId: string,
  reason: string,
  expectedAttempt?: number,
): Promise<QueuedBuyOrder> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(ORDERS, "readwrite");
      const store = tx.objectStore(ORDERS);
      const request = store.get(orderId);
      let updated: QueuedBuyOrder | undefined;
      request.onsuccess = () => {
        const current = request.result as QueuedBuyOrder | undefined;
        if (!current || (expectedAttempt !== undefined &&
            !isCurrentBuyAttempt(current, expectedAttempt))) {
          tx.abort();
          return;
        }
        updated = {
          ...current,
          status: "reconcile_required",
          lastError: reason,
          updatedAt: Date.now(),
        };
        store.put(updated);
      };
      tx.oncomplete = () => updated ? resolve(updated) : reject(new Error("待买订单不存在"));
      tx.onerror = () => reject(tx.error ?? new Error("更新待买订单复核状态失败"));
      tx.onabort = () => reject(tx.error ?? new Error("更新待买订单复核状态事务中止"));
    });
  } finally {
    db.close();
  }
}

/**
 * Claim one buy attempt before sending its POST. The same IndexedDB transaction
 * moves the order into reconciliation hold and increments the attempt counter.
 * A second tab cannot claim the same queued order while the first POST is in flight.
 */
export async function claimBuyOrderSubmission(
  orderId: string,
  now = Date.now(),
): Promise<{ order: QueuedBuyOrder; attempt: number }> {
  if (!orderId || !Number.isSafeInteger(now) || now <= 0) {
    throw new Error("买单提交领取参数无效");
  }
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(ORDERS, "readwrite");
      const store = tx.objectStore(ORDERS);
      const request = store.get(orderId);
      let result: { order: QueuedBuyOrder; attempt: number } | undefined;
      let fatal: Error | null = null;
      request.onsuccess = () => {
        const current = request.result as QueuedBuyOrder | undefined;
        if (!current) {
          fatal = new Error("待买订单不存在");
          tx.abort();
          return;
        }
        if (current.status !== "pending" && current.status !== "partially_filled") {
          fatal = new Error(`待买订单状态为 ${current.status}，禁止重复提交；请先对账`);
          tx.abort();
          return;
        }
        if (!Number.isInteger(current.attemptCount) || current.attemptCount < 0) {
          fatal = new Error("待买订单 attemptCount 无效，必须人工核对");
          tx.abort();
          return;
        }
        const attempt = current.attemptCount;
        const order: QueuedBuyOrder = {
          ...current,
          status: "reconcile_required",
          attemptCount: attempt + 1,
          lastAttemptAt: now,
          lastError: "买单提交状态待交易所对账；禁止再次提交",
          updatedAt: now,
        };
        store.put(order);
        result = { order, attempt };
      };
      request.onerror = () => { fatal = request.error ?? new Error("读取待买订单失败"); tx.abort(); };
      tx.oncomplete = () => result ? resolve(result) : reject(new Error("买单提交领取未完成"));
      tx.onerror = () => reject(fatal ?? tx.error ?? new Error("领取买单提交权失败"));
      tx.onabort = () => reject(fatal ?? tx.error ?? new Error("买单提交领取事务中止"));
    });
  } finally {
    db.close();
  }
}

/** Clear a prior reconciliation hold only after a complete, matching exchange snapshot. */
export async function markBuyOrderReconciled(orderId: string, expectedAttempt?: number): Promise<QueuedBuyOrder> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(ORDERS, "readwrite");
      const store = tx.objectStore(ORDERS);
      const request = store.get(orderId);
      let updated: QueuedBuyOrder | undefined;
      request.onsuccess = () => {
        const current = request.result as QueuedBuyOrder | undefined;
        if (!current || (expectedAttempt !== undefined &&
            (current.attemptCount !== expectedAttempt + 1 || current.status !== "reconcile_required"))) {
          tx.abort();
          return;
        }
        const status = current.remainingUsdt <= 1e-8
          ? "filled"
          : current.filledUsdt > 0
            ? "partially_filled"
            : "pending";
        updated = { ...current, status, lastError: null, updatedAt: Date.now() };
        store.put(updated);
      };
      tx.oncomplete = () => updated ? resolve(updated) : reject(new Error("待买订单不存在"));
      tx.onerror = () => reject(tx.error ?? new Error("清除待买订单复核状态失败"));
      tx.onabort = () => reject(tx.error ?? new Error("清除待买订单复核状态事务中止"));
    });
  } finally {
    db.close();
  }
}

export async function listTradeLedger(): Promise<TradeLedgerEntry[]> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(LEDGER, "readonly");
      const request = tx.objectStore(LEDGER).getAll();
      request.onsuccess = () => resolve((request.result as TradeLedgerEntry[]).sort((a, b) => a.time - b.time));
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}


/**
 * Atomically reserve part of the currently observed USDT free balance.
 * IndexedDB serializes readwrite transactions on this store across tabs,
 * preventing two tabs from allocating the same local free-balance snapshot.
 * This is a local coordination guard, not an exchange-side balance lock.
 */
export async function reserveBuyFunds(input: {
  orderId: string;
  symbol: string;
  requestedUsdt: number;
  observedFreeUsdt: number;
  minNotionalUsdt: number;
  now?: number;
}): Promise<{ reservation: BuyFundsReservation | null; plan: ReturnType<typeof planBuyFundsReservation> }> {
  if (!input.orderId || !input.symbol ||
      ![input.requestedUsdt, input.observedFreeUsdt, input.minNotionalUsdt].every(Number.isFinite) ||
      input.requestedUsdt <= 0 || input.observedFreeUsdt < 0 || input.minNotionalUsdt < 0 ||
      (input.now !== undefined && (!Number.isSafeInteger(input.now) || input.now <= 0))) {
    throw new Error("资金预留参数无效");
  }
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      // Read the live order and reserve against the shared reservation store in
      // one transaction. A stale preflight cannot reserve for a closed order.
      const tx = db.transaction([ORDERS, RESERVATIONS], "readwrite");
      const orderRequest = tx.objectStore(ORDERS).get(input.orderId);
      const store = tx.objectStore(RESERVATIONS);
      const getAll = store.getAll();
      let orderReady = false;
      let reservationsReady = false;
      let currentOrder: QueuedBuyOrder | undefined;
      let result: { reservation: BuyFundsReservation | null; plan: ReturnType<typeof planBuyFundsReservation> } | undefined;
      let fatal: Error | null = null;
      const finish = () => {
        if (!orderReady || !reservationsReady || result || fatal) return;
        const blockReason = buyOrderReservationBlockReason(currentOrder, input.orderId, input.symbol, input.requestedUsdt);
        if (blockReason) {
          fatal = new Error(blockReason);
          tx.abort();
          return;
        }
        const all = getAll.result as BuyFundsReservation[];
        const existing = all.find((item) => item.orderId === input.orderId);
        const plan = planBuyFundsReservation({
          orderId: input.orderId,
          requestedUsdt: input.requestedUsdt,
          observedFreeUsdt: input.observedFreeUsdt,
          activeReservations: all,
          minNotionalUsdt: input.minNotionalUsdt,
        });
        if (!plan.ok) {
          result = { reservation: null, plan };
          return;
        }
        if (existing?.status === "active") {
          if (existing.symbol !== input.symbol) {
            result = {
              reservation: null,
              plan: { ...plan, ok: false, reserveUsdt: 0,
                reason: "同一订单 ID 对应的资金预留交易对不一致，必须人工核对" },
            };
            return;
          }
          result = { reservation: existing, plan };
          return;
        }
        const now = input.now ?? Date.now();
        const reservation: BuyFundsReservation = {
          orderId: input.orderId,
          symbol: input.symbol,
          reservedUsdt: plan.reserveUsdt,
          originalReservedUsdt: plan.reserveUsdt,
          consumedUsdt: 0,
          status: "active",
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          releaseReason: null,
        };
        store.put(reservation);
        result = { reservation, plan };
      };
      orderRequest.onsuccess = () => {
        currentOrder = orderRequest.result as QueuedBuyOrder | undefined;
        orderReady = true;
        finish();
      };
      getAll.onsuccess = () => { reservationsReady = true; finish(); };
      orderRequest.onerror = () => { fatal = orderRequest.error ?? new Error("读取待买订单失败"); tx.abort(); };
      getAll.onerror = () => { fatal = getAll.error ?? new Error("读取资金预留失败"); tx.abort(); };
      tx.oncomplete = () => result ? resolve(result) : reject(fatal ?? new Error("资金预留事务未生成结果"));
      tx.onerror = () => reject(fatal ?? tx.error ?? new Error("资金预留事务失败"));
      tx.onabort = () => reject(fatal ?? tx.error ?? new Error("资金预留事务中止"));
    });
  } finally {
    db.close();
  }
}

/**
 * Atomically reserve the exact BUY amount and claim its exchange submission
 * attempt in one IndexedDB transaction. This prevents a stale preflight or a
 * competing tab from leaving a newly-created reservation behind after claim
 * failure. The reservation is local coordination only, not an exchange lock.
 */
export async function reserveAndClaimBuyOrderSubmission(input: {
  orderId: string;
  symbol: string;
  requestedUsdt: number;
  observedFreeUsdt: number;
  minNotionalUsdt: number;
  expectedOrderUpdatedAt: number;
  expectedAttemptCount: number;
  now?: number;
}): Promise<{
  order: QueuedBuyOrder;
  attempt: number;
  reservation: BuyFundsReservation;
  plan: ReturnType<typeof planBuyFundsReservation>;
}> {
  if (!input.orderId || !input.symbol ||
      ![input.requestedUsdt, input.observedFreeUsdt, input.minNotionalUsdt,
        input.expectedOrderUpdatedAt, input.expectedAttemptCount].every(Number.isFinite) ||
      input.requestedUsdt <= 0 || input.observedFreeUsdt < 0 ||
      input.minNotionalUsdt < 0 || input.expectedOrderUpdatedAt < 0 ||
      !Number.isInteger(input.expectedAttemptCount) || input.expectedAttemptCount < 0 ||
      (input.now !== undefined && (!Number.isSafeInteger(input.now) || input.now <= 0))) {
    throw new Error("买单资金预留与提交领取参数无效");
  }
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([ORDERS, RESERVATIONS], "readwrite");
      const orders = tx.objectStore(ORDERS);
      const reservations = tx.objectStore(RESERVATIONS);
      const orderRequest = orders.get(input.orderId);
      const reservationRequest = reservations.get(input.orderId);
      let orderReady = false;
      let reservationReady = false;
      let currentOrder: QueuedBuyOrder | undefined;
      let currentReservation: BuyFundsReservation | undefined;
      let result: {
        order: QueuedBuyOrder;
        attempt: number;
        reservation: BuyFundsReservation;
        plan: ReturnType<typeof planBuyFundsReservation>;
      } | undefined;
      let fatal: Error | null = null;

      const finish = () => {
        if (!orderReady || !reservationReady || result || fatal) return;
        const liveOrder = currentOrder;
        if (!liveOrder) {
          fatal = new Error("待买订单不存在");
          tx.abort();
          return;
        }
        if (liveOrder.updatedAt !== input.expectedOrderUpdatedAt ||
            liveOrder.attemptCount !== input.expectedAttemptCount) {
          fatal = new Error("预检期间待买订单已变化，拒绝使用过期预检结果提交");
          tx.abort();
          return;
        }
        const blockReason = buyOrderReservationBlockReason(
          liveOrder, input.orderId, input.symbol, input.requestedUsdt,
        );
        if (blockReason) {
          fatal = new Error(blockReason);
          tx.abort();
          return;
        }
        if (!Number.isInteger(liveOrder.attemptCount) || liveOrder.attemptCount < 0) {
          fatal = new Error("待买订单 attemptCount 无效，必须人工核对");
          tx.abort();
          return;
        }

        const all = reservations.getAll();
        all.onerror = () => {
          fatal = all.error ?? new Error("读取资金预留失败");
          tx.abort();
        };
        all.onsuccess = () => {
          if (fatal || result) return;
          const rows = all.result as BuyFundsReservation[];
          const plan = planBuyFundsReservation({
            orderId: input.orderId,
            requestedUsdt: input.requestedUsdt,
            observedFreeUsdt: input.observedFreeUsdt,
            activeReservations: rows,
            minNotionalUsdt: input.minNotionalUsdt,
          });
          if (!plan.ok) {
            fatal = new Error(plan.reason ?? "资金预留计划未通过");
            tx.abort();
            return;
          }
          if (currentReservation?.status === "active" &&
              currentReservation.symbol !== input.symbol) {
            fatal = new Error("同一订单 ID 对应的资金预留交易对不一致，必须人工核对");
            tx.abort();
            return;
          }
          if (plan.reserveUsdt + 1e-8 < input.requestedUsdt) {
            fatal = new Error("重新核算后的可预留 USDT 不足以覆盖本次买单；未领取提交权");
            tx.abort();
            return;
          }

          const now = input.now ?? Date.now();
          const reservation: BuyFundsReservation = currentReservation?.status === "active"
            ? currentReservation
            : {
                orderId: input.orderId,
                symbol: input.symbol,
                reservedUsdt: plan.reserveUsdt,
                originalReservedUsdt: plan.reserveUsdt,
                consumedUsdt: 0,
                status: "active",
                createdAt: currentReservation?.createdAt ?? now,
                updatedAt: now,
                releaseReason: null,
              };
          if (currentReservation?.status !== "active") reservations.put(reservation);

          const attempt = liveOrder.attemptCount;
          const order: QueuedBuyOrder = {
            ...liveOrder,
            status: "reconcile_required",
            attemptCount: attempt + 1,
            lastAttemptAt: now,
            lastError: "买单提交状态待交易所对账；禁止再次提交",
            updatedAt: now,
          };
          orders.put(order);
          result = { order, attempt, reservation, plan };
        };
      };

      orderRequest.onsuccess = () => {
        currentOrder = orderRequest.result as QueuedBuyOrder | undefined;
        orderReady = true;
        finish();
      };
      reservationRequest.onsuccess = () => {
        currentReservation = reservationRequest.result as BuyFundsReservation | undefined;
        reservationReady = true;
        finish();
      };
      orderRequest.onerror = () => {
        fatal = orderRequest.error ?? new Error("读取待买订单失败");
        tx.abort();
      };
      reservationRequest.onerror = () => {
        fatal = reservationRequest.error ?? new Error("读取当前资金预留失败");
        tx.abort();
      };
      tx.oncomplete = () => result
        ? resolve(result)
        : reject(fatal ?? new Error("买单资金预留与提交领取事务未完成"));
      tx.onerror = () => reject(fatal ?? tx.error ?? new Error("买单资金预留与提交领取事务失败"));
      tx.onabort = () => reject(fatal ?? tx.error ?? new Error("买单资金预留与提交领取事务中止"));
    });
  } finally {
    db.close();
  }
}

/**
 * Consume reservation only from exchange-confirmed fill spend.
 * Keep unfilled funds reserved while the exchange order remains open;
 * release the remainder only after caller confirms a terminal order state.
 */
export async function applyConfirmedBuyReservationSpend(
  orderId: string,
  cumulativeConfirmedSpendUsdt: number,
  exchangeOrderTerminal: boolean,
  expectedAttempt: number,
  now = Date.now(),
): Promise<BuyFundsReservation | null> {
  if (!Number.isInteger(expectedAttempt) || expectedAttempt < 0) {
    throw new Error("资金预留 attempt 参数无效");
  }
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      // Fence reservation writes with the persisted order attempt. A late
      // response from an older tab must not consume/release a newer attempt.
      const tx = db.transaction([ORDERS, RESERVATIONS], "readwrite");
      const orders = tx.objectStore(ORDERS);
      const reservations = tx.objectStore(RESERVATIONS);
      const orderRequest = orders.get(orderId);
      const reservationRequest = reservations.get(orderId);
      let orderReady = false;
      let reservationReady = false;
      let currentOrder: QueuedBuyOrder | undefined;
      let currentReservation: BuyFundsReservation | undefined;
      let updated: BuyFundsReservation | undefined;
      let fatal: Error | null = null;
      const finish = () => {
        if (!orderReady || !reservationReady || fatal) return;
        if (!isCurrentBuyAttempt(currentOrder, expectedAttempt)) {
          fatal = new Error("资金预留更新属于过期 attempt，拒绝修改当前预留");
          tx.abort();
          return;
        }
        if (!currentReservation) return;
        try {
          updated = reconcileBuyFundsReservation(
            currentReservation,
            cumulativeConfirmedSpendUsdt,
            exchangeOrderTerminal,
            now,
          );
          reservations.put(updated);
        } catch (error) {
          fatal = error instanceof Error ? error : new Error("更新资金预留失败");
          tx.abort();
        }
      };
      orderRequest.onsuccess = () => {
        currentOrder = orderRequest.result as QueuedBuyOrder | undefined;
        orderReady = true;
        finish();
      };
      reservationRequest.onsuccess = () => {
        currentReservation = reservationRequest.result as BuyFundsReservation | undefined;
        reservationReady = true;
        finish();
      };
      orderRequest.onerror = () => { fatal = orderRequest.error ?? new Error("读取待买订单失败"); tx.abort(); };
      reservationRequest.onerror = () => { fatal = reservationRequest.error ?? new Error("读取资金预留失败"); tx.abort(); };
      tx.oncomplete = () => resolve(updated ?? null);
      tx.onerror = () => reject(fatal ?? tx.error ?? new Error("资金预留更新失败"));
      tx.onabort = () => reject(fatal ?? tx.error ?? new Error("资金预留更新事务中止"));
    });
  } finally {
    db.close();
  }
}

/** Release a reservation only after a terminal snapshot for the current attempt. */
export async function releaseBuyFundsReservation(
  orderId: string,
  exchangeTerminalConfirmed: boolean,
  reason: string,
  expectedAttempt: number,
  now = Date.now(),
): Promise<BuyFundsReservation | null> {
  if (!exchangeTerminalConfirmed) {
    throw new Error("未确认 Binance 订单终态，不允许释放资金预留");
  }
  if (!Number.isInteger(expectedAttempt) || expectedAttempt < 0 || !reason ||
      !Number.isSafeInteger(now) || now <= 0) {
    throw new Error("资金预留释放参数无效");
  }
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([ORDERS, RESERVATIONS], "readwrite");
      const orders = tx.objectStore(ORDERS);
      const reservations = tx.objectStore(RESERVATIONS);
      const orderRequest = orders.get(orderId);
      const reservationRequest = reservations.get(orderId);
      let orderReady = false;
      let reservationReady = false;
      let currentOrder: QueuedBuyOrder | undefined;
      let currentReservation: BuyFundsReservation | undefined;
      let updated: BuyFundsReservation | null = null;
      let fatal: Error | null = null;
      const finish = () => {
        if (!orderReady || !reservationReady || fatal) return;
        if (!isCurrentBuyAttempt(currentOrder, expectedAttempt)) {
          fatal = new Error("资金预留释放属于过期 attempt，拒绝释放当前预留");
          tx.abort();
          return;
        }
        if (!currentReservation) return;
        updated = {
          ...currentReservation,
          reservedUsdt: 0,
          status: "released",
          updatedAt: now,
          releaseReason: reason,
        };
        reservations.put(updated);
      };
      orderRequest.onsuccess = () => {
        currentOrder = orderRequest.result as QueuedBuyOrder | undefined;
        orderReady = true;
        finish();
      };
      reservationRequest.onsuccess = () => {
        currentReservation = reservationRequest.result as BuyFundsReservation | undefined;
        reservationReady = true;
        finish();
      };
      orderRequest.onerror = () => { fatal = orderRequest.error ?? new Error("读取待买订单失败"); tx.abort(); };
      reservationRequest.onerror = () => { fatal = reservationRequest.error ?? new Error("读取资金预留失败"); tx.abort(); };
      tx.oncomplete = () => resolve(updated);
      tx.onerror = () => reject(fatal ?? tx.error ?? new Error("释放资金预留失败"));
      tx.onabort = () => reject(fatal ?? tx.error ?? new Error("资金预留事务中止"));
    });
  } finally {
    db.close();
  }
}

export async function listBuyFundsReservations(): Promise<BuyFundsReservation[]> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(RESERVATIONS, "readonly");
      const request = tx.objectStore(RESERVATIONS).getAll();
      request.onsuccess = () => resolve((request.result as BuyFundsReservation[])
        .sort((a, b) => a.createdAt - b.createdAt));
      request.onerror = () => reject(request.error ?? new Error("读取资金预留列表失败"));
    });
  } finally {
    db.close();
  }
}




/** Read confirmed-fill email events awaiting a notification dispatcher. */
export async function listTradeNotificationOutbox(): Promise<TradeNotificationOutboxEvent[]> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(NOTIFICATION_OUTBOX, "readonly");
      const request = tx.objectStore(NOTIFICATION_OUTBOX).getAll();
      request.onsuccess = () => resolve((request.result as TradeNotificationOutboxEvent[])
        .sort((a, b) => a.createdAt - b.createdAt));
      request.onerror = () => reject(request.error ?? new Error("读取成交通知队列失败"));
    });
  } finally {
    db.close();
  }
}

/**
 * Atomically lease pending/failed notification events for one dispatcher.
 * IndexedDB readwrite serialization prevents concurrent tabs from claiming
 * the same event. Expired leases are recoverable after a crashed tab.
 */
function createNotificationLeaseToken(): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("当前环境无法安全生成成交通知租约令牌");
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function claimTradeNotificationOutboxBatch(
  limit = 20,
  now = Date.now(),
  leaseMs = 120_000,
): Promise<TradeNotificationOutboxEvent[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20 ||
      !Number.isSafeInteger(now) || now <= 0 ||
      !Number.isSafeInteger(leaseMs) || leaseMs < 10_000 || leaseMs > 10 * 60_000) {
    throw new Error("成交通知领取参数无效");
  }
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(NOTIFICATION_OUTBOX, "readwrite");
      const store = tx.objectStore(NOTIFICATION_OUTBOX);
      const request = store.getAll();
      let claimed: TradeNotificationOutboxEvent[] = [];
      request.onsuccess = () => {
        const rows = (request.result as TradeNotificationOutboxEvent[])
          .filter((event) => isTradeNotificationClaimable(event, now))
          .sort((a, b) => a.createdAt - b.createdAt)
          .slice(0, limit);
        claimed = rows.map((event) => ({
          ...event,
          status: "sending",
          leaseUntil: now + leaseMs,
          leaseToken: createNotificationLeaseToken(),
          updatedAt: now,
          lastError: null,
        }));
        for (const event of claimed) store.put(event);
      };
      request.onerror = () => { reject(request.error ?? new Error("读取待投递成交通知失败")); tx.abort(); };
      tx.oncomplete = () => resolve(claimed);
      tx.onerror = () => reject(tx.error ?? new Error("领取成交通知失败"));
      tx.onabort = () => reject(tx.error ?? new Error("成交通知领取事务中止"));
    });
  } finally {
    db.close();
  }
}

/** Mark an outbox event sent only after the notification endpoint confirms acceptance. */
export async function markTradeNotificationSent(
  id: string,
  leaseToken: string,
  now = Date.now(),
): Promise<void> {
  if (!id || !leaseToken || !Number.isSafeInteger(now) || now <= 0) {
    throw new Error("成交通知完成参数无效");
  }
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(NOTIFICATION_OUTBOX, "readwrite");
      const store = tx.objectStore(NOTIFICATION_OUTBOX);
      const request = store.get(id);
      let fatal: Error | null = null;
      request.onsuccess = () => {
        const current = request.result as TradeNotificationOutboxEvent | undefined;
        if (!current) {
          fatal = new Error("成交通知事件不存在");
          tx.abort();
          return;
        }
        if (current.status === "sent") return;
        if (current.status !== "sending" || current.leaseToken !== leaseToken) {
          fatal = new Error("成交通知租约已失效，拒绝旧调度器覆盖新状态");
          tx.abort();
          return;
        }
        store.put({
          ...current,
          status: "sent",
          leaseUntil: null,
          leaseToken: null,
          nextAttemptAt: null,
          sentAt: now,
          updatedAt: now,
          lastError: null,
        });
      };
      request.onerror = () => { fatal = request.error ?? new Error("读取成交通知事件失败"); tx.abort(); };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(fatal ?? tx.error ?? new Error("更新成交通知状态失败"));
      tx.onabort = () => reject(fatal ?? tx.error ?? new Error("成交通知事件更新事务中止"));
    });
  } finally {
    db.close();
  }
}

/** Record a delivery failure only when the caller still owns the current lease. */
export async function markTradeNotificationFailed(
  id: string,
  leaseToken: string,
  reason: string,
  now = Date.now(),
): Promise<void> {
  if (!id || !leaseToken || !Number.isSafeInteger(now) || now <= 0) {
    throw new Error("成交通知失败参数无效");
  }
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(NOTIFICATION_OUTBOX, "readwrite");
      const store = tx.objectStore(NOTIFICATION_OUTBOX);
      const request = store.get(id);
      let fatal: Error | null = null;
      request.onsuccess = () => {
        const current = request.result as TradeNotificationOutboxEvent | undefined;
        if (!current) {
          fatal = new Error("成交通知事件不存在");
          tx.abort();
          return;
        }
        if (current.status === "sent") return;
        if (current.status !== "sending" || current.leaseToken !== leaseToken) {
          fatal = new Error("成交通知租约已失效，拒绝旧调度器覆盖新状态");
          tx.abort();
          return;
        }
        store.put({
          ...current,
          status: "failed",
          leaseUntil: null,
          leaseToken: null,
          attemptCount: current.attemptCount + 1,
          nextAttemptAt: now + Math.min(60 * 60_000, 30_000 * (2 ** Math.min(current.attemptCount, 7))),
          updatedAt: now,
          lastError: reason.slice(0, 500),
        });
      };
      request.onerror = () => { fatal = request.error ?? new Error("读取成交通知事件失败"); tx.abort(); };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(fatal ?? tx.error ?? new Error("记录成交通知失败状态失败"));
      tx.onabort = () => reject(fatal ?? tx.error ?? new Error("成交通知失败状态事务中止"));
    });
  } finally {
    db.close();
  }
}


/**
 * Persist redemption intents before any future exchange mutation.
 * Add-if-absent is atomic across tabs; an existing intent is never silently
 * resized or reset to planned after a timeout.
 */
export async function enqueueEarnRedemptionIntents(
  intents: EarnRedemptionIntent[],
): Promise<{ created: number; existing: number; intents: EarnRedemptionIntent[] }> {
  if (intents.length === 0) return { created: 0, existing: 0, intents: [] };
  const ids = new Set<string>();
  for (const intent of intents) {
    if (!intent.id || !intent.orderId || !intent.productId || intent.asset !== "USDT" ||
        !Number.isFinite(intent.amountUsdt) || intent.amountUsdt <= 0) {
      throw new Error("活期理财赎回意图字段无效");
    }
    if (ids.has(intent.id)) throw new Error("同一批赎回计划包含重复意图 ID");
    ids.add(intent.id);
  }
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(EARN_REDEMPTIONS, "readwrite");
      const store = tx.objectStore(EARN_REDEMPTIONS);
      let created = 0;
      let existing = 0;
      const persistedIntents: EarnRedemptionIntent[] = new Array(intents.length);
      let fatal: Error | null = null;
      intents.forEach((intent, index) => {
        const request = store.get(intent.id);
        request.onsuccess = () => {
          const prior = request.result as EarnRedemptionIntent | undefined;
          if (prior) {
            if (prior.orderId !== intent.orderId || prior.productId !== intent.productId ||
                Math.abs(prior.amountUsdt - intent.amountUsdt) > 1e-8) {
              fatal = new Error("已存在的赎回意图与新计划金额不一致，必须人工复核");
              tx.abort();
              return;
            }
            if (prior.status === "credited" || prior.status === "failed") {
              fatal = new Error("该订单的理财赎回意图已进入终态；新的赎回批次必须先人工复核");
              tx.abort();
              return;
            }
            existing += 1;
            persistedIntents[index] = prior;
          } else {
            store.add(intent);
            created += 1;
            persistedIntents[index] = intent;
          }
        };
        request.onerror = () => {
          fatal = request.error ?? new Error("读取理财赎回意图失败");
          tx.abort();
        };
      });
      tx.oncomplete = () => resolve({ created, existing, intents: persistedIntents });
      tx.onerror = () => reject(fatal ?? tx.error ?? new Error("保存理财赎回意图失败"));
      tx.onabort = () => reject(fatal ?? tx.error ?? new Error("保存理财赎回意图事务中止"));
    });
  } finally {
    db.close();
  }
}

/**
 * Atomically claim a planned redemption before the network POST.
 * Multiple tabs cannot both submit the same intent; any non-planned status
 * requires reconciliation instead of another mutation request.
 */
export async function claimEarnRedemptionIntentForSubmit(
  id: string,
  now = Date.now(),
): Promise<EarnRedemptionIntent> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(EARN_REDEMPTIONS, "readwrite");
      const store = tx.objectStore(EARN_REDEMPTIONS);
      const request = store.get(id);
      let claimed: EarnRedemptionIntent | undefined;
      let fatal: Error | null = null;
      request.onsuccess = () => {
        const current = request.result as EarnRedemptionIntent | undefined;
        if (!current) {
          fatal = new Error("理财赎回意图不存在");
          tx.abort();
          return;
        }
        if (current.status !== "planned") {
          fatal = new Error(`赎回意图状态为 ${current.status}，禁止再次提交；请先对账`);
          tx.abort();
          return;
        }
        try {
          claimed = transitionEarnRedemption(current, "submitting", {}, now);
          store.put(claimed);
        } catch (error) {
          fatal = error instanceof Error ? error : new Error("领取赎回意图失败");
          tx.abort();
        }
      };
      request.onerror = () => { fatal = request.error ?? new Error("读取赎回意图失败"); tx.abort(); };
      tx.oncomplete = () => claimed ? resolve(claimed) : reject(new Error("赎回意图领取未完成"));
      tx.onerror = () => reject(fatal ?? tx.error ?? new Error("领取赎回意图失败"));
      tx.onabort = () => reject(fatal ?? tx.error ?? new Error("赎回意图领取事务中止"));
    });
  } finally {
    db.close();
  }
}

/** Apply one validated state transition to a persisted redemption intent. */
export async function updateEarnRedemptionIntent(
  id: string,
  nextStatus: EarnRedemptionStatus,
  patch: Partial<Pick<EarnRedemptionIntent, "redemptionId" | "lastError">> = {},
  now = Date.now(),
): Promise<EarnRedemptionIntent> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(EARN_REDEMPTIONS, "readwrite");
      const store = tx.objectStore(EARN_REDEMPTIONS);
      const request = store.get(id);
      let updated: EarnRedemptionIntent | undefined;
      let fatal: Error | null = null;
      request.onsuccess = () => {
        const current = request.result as EarnRedemptionIntent | undefined;
        if (!current) {
          fatal = new Error("理财赎回意图不存在");
          tx.abort();
          return;
        }
        try {
          if (current.status === nextStatus) {
            updated = { ...current, ...patch, updatedAt: now };
            store.put(updated);
          } else {
            updated = transitionEarnRedemption(current, nextStatus, patch, now);
            store.put(updated);
          }
        } catch (error) {
          fatal = error instanceof Error ? error : new Error("更新理财赎回状态失败");
          tx.abort();
        }
      };
      request.onerror = () => { fatal = request.error ?? new Error("读取理财赎回意图失败"); tx.abort(); };
      tx.oncomplete = () => updated ? resolve(updated) : reject(new Error("理财赎回状态更新未完成"));
      tx.onerror = () => reject(fatal ?? tx.error ?? new Error("更新理财赎回状态失败"));
      tx.onabort = () => reject(fatal ?? tx.error ?? new Error("理财赎回事务中止"));
    });
  } finally {
    db.close();
  }
}

export async function listEarnRedemptionIntents(
  orderId?: string,
): Promise<EarnRedemptionIntent[]> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(EARN_REDEMPTIONS, "readonly");
      const request = tx.objectStore(EARN_REDEMPTIONS).getAll();
      request.onsuccess = () => resolve(
        (request.result as EarnRedemptionIntent[])
          .filter((item) => !orderId || item.orderId === orderId)
          .sort((a, b) => a.createdAt - b.createdAt),
      );
      request.onerror = () => reject(request.error ?? new Error("读取理财赎回队列失败"));
    });
  } finally {
    db.close();
  }
}


/**
 * After a matching Earn redemption is confirmed credited to Spot, expand this
 * order's local Spot reservation from the newly observed free balance. This is
 * the only path that may enlarge an existing reservation; previews never do.
 */
export async function topUpBuyFundsReservationAfterEarnCredit(input: {
  orderId: string;
  symbol: string;
  requestedRemainingUsdt: number;
  observedFreeUsdt: number;
  expectedAttemptCount: number;
  expectedOrderUpdatedAt: number;
  now?: number;
}): Promise<BuyFundsReservation | null> {
  if (!input.orderId || !input.symbol ||
      ![input.requestedRemainingUsdt, input.observedFreeUsdt].every(Number.isFinite) ||
      input.requestedRemainingUsdt < 0 || input.observedFreeUsdt < 0 ||
      !Number.isInteger(input.expectedAttemptCount) || input.expectedAttemptCount < 0 ||
      !Number.isSafeInteger(input.expectedOrderUpdatedAt) || input.expectedOrderUpdatedAt <= 0 ||
      (input.now !== undefined && (!Number.isSafeInteger(input.now) || input.now <= 0))) {
    throw new Error("理财到账后的资金预留参数无效");
  }
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([ORDERS, RESERVATIONS], "readwrite");
      const orderRequest = tx.objectStore(ORDERS).get(input.orderId);
      const store = tx.objectStore(RESERVATIONS);
      const getAll = store.getAll();
      let orderReady = false;
      let reservationsReady = false;
      let currentOrder: QueuedBuyOrder | undefined;
      let result: BuyFundsReservation | null = null;
      let fatal: Error | null = null;
      const finish = () => {
        if (!orderReady || !reservationsReady || fatal) return;
        const blockReason = buyOrderReservationBlockReason(currentOrder, input.orderId, input.symbol, input.requestedRemainingUsdt);
        if (blockReason) {
          fatal = new Error(blockReason);
          tx.abort();
          return;
        }
        if (currentOrder!.attemptCount !== input.expectedAttemptCount ||
            currentOrder!.updatedAt !== input.expectedOrderUpdatedAt ||
            Math.abs(currentOrder!.remainingUsdt - input.requestedRemainingUsdt) > 1e-8) {
          fatal = new Error("待买订单在理财到账后已变化，拒绝使用旧快照扩展资金预留");
          tx.abort();
          return;
        }
        const all = getAll.result as BuyFundsReservation[];
        const current = all.find((item) => item.orderId === input.orderId) ?? null;
        if (current && current.symbol !== input.symbol) {
          fatal = new Error("同一订单 ID 对应的资金预留交易对不一致，必须人工核对");
          tx.abort();
          return;
        }
        const plan = planBuyFundsReservationTopUp({
          orderId: input.orderId,
          requestedRemainingUsdt: input.requestedRemainingUsdt,
          observedFreeUsdt: input.observedFreeUsdt,
          activeReservations: all,
          currentReservation: current,
        });
        if (!plan.ok) {
          fatal = new Error(plan.reason ?? "活动资金预留数据无效，无法扩展预留");
          tx.abort();
          return;
        }
        if (plan.additionalUsdt <= 1e-8) {
          result = current;
          return;
        }
        const startsNewAttempt = current?.status === "released";
        // A released reservation belongs to a completed exchange attempt.
        // The next attempt has its own cumulative fill stream, so it must not
        // inherit the prior attempt's consumed amount.
        const consumedUsdt = startsNewAttempt ? 0 : (current?.consumedUsdt ?? 0);
        const now = input.now ?? Date.now();
        result = {
          orderId: input.orderId,
          symbol: input.symbol,
          reservedUsdt: plan.reservedUsdt,
          originalReservedUsdt: startsNewAttempt
            ? plan.reservedUsdt
            : Math.max(
                current?.originalReservedUsdt ?? consumedUsdt,
                consumedUsdt + plan.reservedUsdt,
              ),
          consumedUsdt,
          status: "active",
          createdAt: startsNewAttempt ? now : (current?.createdAt ?? now),
          updatedAt: now,
          releaseReason: null,
        };
        store.put(result);
      };
      orderRequest.onsuccess = () => { currentOrder = orderRequest.result as QueuedBuyOrder | undefined; orderReady = true; finish(); };
      getAll.onsuccess = () => { reservationsReady = true; finish(); };
      orderRequest.onerror = () => { fatal = orderRequest.error ?? new Error("读取待买订单失败"); tx.abort(); };
      getAll.onerror = () => { fatal = getAll.error ?? new Error("读取资金预留失败"); tx.abort(); };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(fatal ?? tx.error ?? new Error("理财到账后扩展资金预留失败"));
      tx.onabort = () => reject(fatal ?? tx.error ?? new Error("理财到账后扩展资金预留事务中止"));
    });
  } finally {
    db.close();
  }
}
