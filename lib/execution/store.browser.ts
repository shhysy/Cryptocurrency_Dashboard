import type { ExecutionFill, QueuedBuyOrder, TradeLedgerEntry } from "./types";
import { applyConfirmedBuyFill } from "./queue";

const DB_NAME = "long-term-investment-execution";
const DB_VERSION = 1;
const ORDERS = "buy-orders";
const FILLS = "fills";
const LEDGER = "trade-ledger";

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("当前环境不支持 IndexedDB"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ORDERS)) db.createObjectStore(ORDERS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(FILLS)) db.createObjectStore(FILLS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(LEDGER)) db.createObjectStore(LEDGER, { keyPath: "id" });
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
