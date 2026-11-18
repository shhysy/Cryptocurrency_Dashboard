import type { ExecutionFill, QueuedBuyOrder, TradeLedgerEntry } from "./types";
import { applyConfirmedBuyFill } from "./queue";
import { planBuyFundsReservation, remainingReservationAfterFill, type BuyFundsReservation } from "./fund-reservation";
import { buildTradeFillNotificationEvent, type TradeNotificationOutboxEvent } from "./notification-outbox";
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
    request.onsuccess = () => resolve(request.result);
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
      const getOrder = orders.get(queuedOrderId);
      const getReservation = reservations.get(queuedOrderId);
      let fillReady = false;
      let orderReady = false;
      let reservationReady = false;
      let existingFill = false;
      let currentOrder: QueuedBuyOrder | undefined;
      let currentReservation: BuyFundsReservation | undefined;
      let result: { recorded: boolean; ledger: TradeLedgerEntry; order: QueuedBuyOrder } | undefined;
      let fatalError: Error | null = null;

      const finishReads = () => {
        if (!fillReady || !orderReady || !reservationReady || result || fatalError) return;
        if (!currentOrder) {
          fatalError = new Error("成交对应的待买订单不存在");
          tx.abort();
          return;
        }
        let ledger: TradeLedgerEntry = { ...fill, id, realizedPnlUsdt: null };
        if (existingFill) {
          result = { recorded: false, ledger, order: currentOrder };
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
            const remaining = remainingReservationAfterFill(currentReservation, cumulativeSpendUsdt);
            reservations.put({
              ...currentReservation,
              reservedUsdt: remaining,
              originalReservedUsdt: currentReservation.originalReservedUsdt ?? currentReservation.reservedUsdt,
              consumedUsdt: cumulativeSpendUsdt,
              status: remaining <= 1e-8 ? "released" : "active",
              updatedAt: Date.now(),
              releaseReason: remaining <= 1e-8 ? "已由真实成交完全消耗" : null,
            } satisfies BuyFundsReservation);
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
      let result: { recorded: boolean; ledger: TradeLedgerEntry } | undefined;
      let fatal: Error | null = null;
      getFill.onsuccess = () => {
        const ledger: TradeLedgerEntry = { ...fill, id, realizedPnlUsdt: null, sellKind };
        if (getFill.result) {
          result = { recorded: false, ledger };
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
      getFill.onerror = () => { fatal = getFill.error ?? new Error("查询卖出成交 ID 失败"); tx.abort(); };
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
        if (!current) {
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

/** Clear a prior reconciliation hold only after a complete, matching exchange snapshot. */
export async function markBuyOrderReconciled(orderId: string): Promise<QueuedBuyOrder> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(ORDERS, "readwrite");
      const store = tx.objectStore(ORDERS);
      const request = store.get(orderId);
      let updated: QueuedBuyOrder | undefined;
      request.onsuccess = () => {
        const current = request.result as QueuedBuyOrder | undefined;
        if (!current) {
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
  if (!input.orderId || !input.symbol) throw new Error("资金预留缺少订单或交易对标识");
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(RESERVATIONS, "readwrite");
      const store = tx.objectStore(RESERVATIONS);
      const getAll = store.getAll();
      let result: { reservation: BuyFundsReservation | null; plan: ReturnType<typeof planBuyFundsReservation> } | undefined;
      let fatal: Error | null = null;
      getAll.onsuccess = () => {
        const all = getAll.result as BuyFundsReservation[];
        const existing = all.find((item) => item.orderId === input.orderId);
        if (existing?.status === "active") {
          const plan = {
            ok: true,
            reserveUsdt: existing.reservedUsdt,
            availableUsdt: existing.reservedUsdt,
            totalReservedUsdt: all
              .filter((item) => item.status === "active" && item.orderId !== input.orderId)
              .reduce((sum, item) => sum + item.reservedUsdt, 0),
            reason: null,
          };
          result = { reservation: existing, plan };
          return;
        }
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
 * Consume reservation only from exchange-confirmed fill spend.
 * Keep unfilled funds reserved while the exchange order remains open;
 * release the remainder only after caller confirms a terminal order state.
 */
export async function applyConfirmedBuyReservationSpend(
  orderId: string,
  cumulativeConfirmedSpendUsdt: number,
  exchangeOrderTerminal: boolean,
  now = Date.now(),
): Promise<BuyFundsReservation | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(RESERVATIONS, "readwrite");
      const store = tx.objectStore(RESERVATIONS);
      const request = store.get(orderId);
      let updated: BuyFundsReservation | undefined;
      let fatal: Error | null = null;
      request.onsuccess = () => {
        const current = request.result as BuyFundsReservation | undefined;
        if (!current) {
          updated = undefined;
          return;
        }
        try {
          const remaining = remainingReservationAfterFill(current, cumulativeConfirmedSpendUsdt);
          updated = {
            ...current,
            reservedUsdt: exchangeOrderTerminal ? 0 : remaining,
            originalReservedUsdt: current.originalReservedUsdt ?? current.reservedUsdt,
            consumedUsdt: cumulativeConfirmedSpendUsdt,
            status: exchangeOrderTerminal || remaining <= 1e-8 ? "released" : "active",
            updatedAt: now,
            releaseReason: exchangeOrderTerminal ? "Binance 已确认订单进入终态" : null,
          };
          store.put(updated);
        } catch (error) {
          fatal = error instanceof Error ? error : new Error("更新资金预留失败");
          tx.abort();
        }
      };
      request.onerror = () => { fatal = request.error ?? new Error("读取资金预留失败"); tx.abort(); };
      tx.oncomplete = () => resolve(updated ?? null);
      tx.onerror = () => reject(fatal ?? tx.error ?? new Error("资金预留更新失败"));
      tx.onabort = () => reject(fatal ?? tx.error ?? new Error("资金预留更新事务中止"));
    });
  } finally {
    db.close();
  }
}

/** Release a reservation only when the caller has positively confirmed a terminal exchange order. */
export async function releaseBuyFundsReservation(
  orderId: string,
  exchangeTerminalConfirmed: boolean,
  reason: string,
  now = Date.now(),
): Promise<BuyFundsReservation | null> {
  if (!exchangeTerminalConfirmed) {
    throw new Error("未确认 Binance 订单终态，不允许释放资金预留");
  }
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(RESERVATIONS, "readwrite");
      const store = tx.objectStore(RESERVATIONS);
      const request = store.get(orderId);
      let updated: BuyFundsReservation | null = null;
      request.onsuccess = () => {
        const current = request.result as BuyFundsReservation | undefined;
        if (!current) return;
        updated = {
          ...current,
          reservedUsdt: 0,
          status: "released",
          updatedAt: now,
          releaseReason: reason,
        };
        store.put(updated);
      };
      tx.oncomplete = () => resolve(updated);
      tx.onerror = () => reject(tx.error ?? new Error("释放资金预留失败"));
      tx.onabort = () => reject(tx.error ?? new Error("释放资金预留事务中止"));
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

/** Mark an outbox event sent only after the notification endpoint confirms acceptance. */
export async function markTradeNotificationSent(id: string, now = Date.now()): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(NOTIFICATION_OUTBOX, "readwrite");
      const store = tx.objectStore(NOTIFICATION_OUTBOX);
      const request = store.get(id);
      request.onsuccess = () => {
        const current = request.result as TradeNotificationOutboxEvent | undefined;
        if (!current) { tx.abort(); return; }
        if (current.status === "sent") return;
        store.put({ ...current, status: "sent", sentAt: now, updatedAt: now, lastError: null });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("更新成交通知状态失败"));
      tx.onabort = () => reject(tx.error ?? new Error("成交通知事件不存在"));
    });
  } finally {
    db.close();
  }
}

/** Record a delivery failure without deleting the confirmed trade event. */
export async function markTradeNotificationFailed(
  id: string,
  reason: string,
  now = Date.now(),
): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(NOTIFICATION_OUTBOX, "readwrite");
      const store = tx.objectStore(NOTIFICATION_OUTBOX);
      const request = store.get(id);
      request.onsuccess = () => {
        const current = request.result as TradeNotificationOutboxEvent | undefined;
        if (!current) { tx.abort(); return; }
        if (current.status === "sent") return;
        store.put({
          ...current,
          status: "failed",
          attemptCount: current.attemptCount + 1,
          updatedAt: now,
          lastError: reason.slice(0, 500),
        });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("记录成交通知失败状态失败"));
      tx.onabort = () => reject(tx.error ?? new Error("成交通知事件不存在"));
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
  now?: number;
}): Promise<BuyFundsReservation | null> {
  if (!input.orderId || !input.symbol ||
      ![input.requestedRemainingUsdt, input.observedFreeUsdt].every(Number.isFinite) ||
      input.requestedRemainingUsdt < 0 || input.observedFreeUsdt < 0) {
    throw new Error("理财到账后的资金预留参数无效");
  }
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(RESERVATIONS, "readwrite");
      const store = tx.objectStore(RESERVATIONS);
      const getAll = store.getAll();
      let result: BuyFundsReservation | null = null;
      let fatal: Error | null = null;
      getAll.onsuccess = () => {
        const all = getAll.result as BuyFundsReservation[];
        const current = all.find((item) => item.orderId === input.orderId);
        const otherReserved = all
          .filter((item) => item.status === "active" && item.orderId !== input.orderId)
          .reduce((sum, item) => sum + Math.max(0, item.reservedUsdt), 0);
        const available = Math.max(0, input.observedFreeUsdt - otherReserved);
        const remainingToReserve = Math.min(input.requestedRemainingUsdt, available);
        if (remainingToReserve <= 1e-8) {
          result = current ?? null;
          return;
        }
        const consumedUsdt = current?.consumedUsdt ?? 0;
        result = {
          orderId: input.orderId,
          symbol: input.symbol,
          reservedUsdt: remainingToReserve,
          originalReservedUsdt: consumedUsdt + remainingToReserve,
          consumedUsdt,
          status: "active",
          createdAt: current?.createdAt ?? (input.now ?? Date.now()),
          updatedAt: input.now ?? Date.now(),
          releaseReason: null,
        };
        store.put(result);
      };
      getAll.onerror = () => { fatal = getAll.error ?? new Error("读取资金预留失败"); tx.abort(); };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(fatal ?? tx.error ?? new Error("理财到账后扩展资金预留失败"));
      tx.onabort = () => reject(fatal ?? tx.error ?? new Error("理财到账后扩展资金预留事务中止"));
    });
  } finally {
    db.close();
  }
}
