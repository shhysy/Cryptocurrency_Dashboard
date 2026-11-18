import type { ExecutionFill, QueuedBuyOrder, TradeLedgerEntry } from "./types";
import { applyConfirmedBuyFill } from "./queue";
import { planBuyFundsReservation, remainingReservationAfterFill, type BuyFundsReservation } from "./fund-reservation";

const DB_NAME = "long-term-investment-execution";
const DB_VERSION = 2;
const ORDERS = "buy-orders";
const FILLS = "fills";
const LEDGER = "trade-ledger";
const RESERVATIONS = "buy-funds-reservations";

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
      const tx = db.transaction([ORDERS, FILLS, LEDGER], "readwrite");
      const orders = tx.objectStore(ORDERS);
      const fills = tx.objectStore(FILLS);
      const ledgerStore = tx.objectStore(LEDGER);
      const getFill = fills.get(id);
      const getOrder = orders.get(queuedOrderId);
      let fillReady = false;
      let orderReady = false;
      let existingFill = false;
      let currentOrder: QueuedBuyOrder | undefined;
      let result: { recorded: boolean; ledger: TradeLedgerEntry; order: QueuedBuyOrder } | undefined;
      let fatalError: Error | null = null;

      const finishReads = () => {
        if (!fillReady || !orderReady || result || fatalError) return;
        if (!currentOrder) {
          fatalError = new Error("成交对应的待买订单不存在");
          tx.abort();
          return;
        }
        const ledger: TradeLedgerEntry = { ...fill, id, realizedPnlUsdt: null };
        if (existingFill) {
          result = { recorded: false, ledger, order: currentOrder };
          return;
        }
        try {
          const updatedOrder = applyConfirmedBuyFill(
            currentOrder,
            fill.quoteQty + fill.commissionUsdt,
          );
          fills.add({ id, fill });
          ledgerStore.add(ledger);
          orders.put(updatedOrder);
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
      getFill.onerror = () => { fatalError = getFill.error ?? new Error("查询成交 ID 失败"); };
      getOrder.onerror = () => { fatalError = getOrder.error ?? new Error("读取待买订单失败"); };
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
): Promise<BuyFundsReservation> {
  if (!exchangeTerminalConfirmed) {
    throw new Error("未确认 Binance 订单终态，不允许释放资金预留");
  }
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(RESERVATIONS, "readwrite");
      const store = tx.objectStore(RESERVATIONS);
      const request = store.get(orderId);
      let updated: BuyFundsReservation | undefined;
      request.onsuccess = () => {
        const current = request.result as BuyFundsReservation | undefined;
        if (!current) {
          tx.abort();
          return;
        }
        updated = {
          ...current,
          reservedUsdt: 0,
          status: "released",
          updatedAt: now,
          releaseReason: reason,
        };
        store.put(updated);
      };
      tx.oncomplete = () => updated ? resolve(updated) : reject(new Error("资金预留记录不存在"));
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
