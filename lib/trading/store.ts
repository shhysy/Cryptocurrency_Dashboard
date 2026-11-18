/**
 * Browser-local durable store for the trading workflow.
 * No exchange calls are made here. CSV is an export/backup, not the source of truth.
 */

export type QueueStatus =
  | "queued"
  | "partially-filled"
  | "filled"
  | "blocked"
  | "reconcile-required"
  | "cancelled";

export interface QueuedOrder {
  id: string;
  eventKey: string;
  symbol: string;
  side: "BUY" | "SELL";
  strategyTag: string;
  plannedQuoteUsdt: number;
  filledQuoteUsdt: number;
  remainingQuoteUsdt: number;
  status: QueueStatus;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

export interface StoredExecution {
  eventKey: string;
  clientOrderId: string;
  exchangeOrderId?: string;
  symbol: string;
  side: "BUY" | "SELL";
  status: string;
  requestedQty: number;
  executedQty: number;
  cumulativeQuote: number;
  updatedAt: number;
}

export interface StoredTrade {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  time: number;
  price: number;
  qty: number;
  quoteQty: number;
  commission: number;
  commissionAsset: string;
  orderId: string;
  eventKey: string;
}

const DB_NAME = "long-term-signal-trading";
const DB_VERSION = 1;
const ORDERS = "orders";
const EXECUTIONS = "executions";
const TRADES = "trades";

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("当前环境不支持 IndexedDB"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ORDERS)) db.createObjectStore(ORDERS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(EXECUTIONS)) db.createObjectStore(EXECUTIONS, { keyPath: "eventKey" });
      if (!db.objectStoreNames.contains(TRADES)) db.createObjectStore(TRADES, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("打开交易数据库失败"));
    request.onblocked = () => reject(new Error("交易数据库升级被其他标签页阻塞，请关闭旧页面后重试"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 请求失败"));
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = action(tx.objectStore(storeName));
      let result: T;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB 操作失败"));
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB 事务失败"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB 事务已中止"));
    });
  } finally {
    db.close();
  }
}

export function saveQueuedOrder(order: QueuedOrder): Promise<IDBValidKey> {
  if (!order.id || !order.eventKey || !order.symbol) throw new Error("订单缺少唯一 ID、事件键或币种");
  if (![order.plannedQuoteUsdt, order.filledQuoteUsdt, order.remainingQuoteUsdt].every(Number.isFinite) ||
      order.plannedQuoteUsdt < 0 || order.filledQuoteUsdt < 0 || order.remainingQuoteUsdt < 0) {
    throw new Error("订单金额字段无效");
  }
  return withStore(ORDERS, "readwrite", (store) => store.put(order));
}

export function getQueuedOrder(id: string): Promise<QueuedOrder | undefined> {
  return withStore(ORDERS, "readonly", (store) => store.get(id));
}

export function listQueuedOrders(): Promise<QueuedOrder[]> {
  return withStore(ORDERS, "readonly", (store) => store.getAll());
}

export function saveExecution(record: StoredExecution): Promise<IDBValidKey> {
  if (!record.eventKey || !record.clientOrderId) throw new Error("执行记录缺少幂等键或客户端订单 ID");
  return withStore(EXECUTIONS, "readwrite", (store) => store.put(record));
}

export function listExecutions(): Promise<StoredExecution[]> {
  return withStore(EXECUTIONS, "readonly", (store) => store.getAll());
}

/** Adds a trade only once. IndexedDB add() enforces the unique exchange trade ID. */
export async function addTradeOnce(trade: StoredTrade): Promise<boolean> {
  if (!trade.id || !trade.orderId || !trade.eventKey) throw new Error("成交记录缺少唯一 ID、订单 ID 或事件键");
  const db = await openDb();
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(TRADES, "readwrite");
      const request = tx.objectStore(TRADES).add(trade);
      let inserted = false;
      request.onsuccess = () => { inserted = true; };
      request.onerror = (event) => {
        if (request.error?.name === "ConstraintError") {
          event.preventDefault();
          event.stopPropagation();
          inserted = false;
        } else {
          reject(request.error ?? new Error("写入成交记录失败"));
        }
      };
      tx.oncomplete = () => resolve(inserted);
      tx.onerror = () => reject(tx.error ?? new Error("成交记录事务失败"));
      tx.onabort = () => reject(tx.error ?? new Error("成交记录事务中止"));
    });
  } finally {
    db.close();
  }
}

export function listTrades(): Promise<StoredTrade[]> {
  return withStore(TRADES, "readonly", (store) => store.getAll());
}

function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  // Prevent spreadsheet formula injection in exported text fields.
  if (/^[=+@\\-\\t\\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function queuedOrdersToCsv(orders: QueuedOrder[]): string {
  const headers = [
    "订单ID", "策略事件键", "币种", "方向", "策略档位", "计划金额USDT",
    "已成交金额USDT", "剩余金额USDT", "状态", "创建时间", "更新时间", "错误信息",
  ];
  const rows = orders.map((o) => [
    o.id, o.eventKey, o.symbol, o.side, o.strategyTag, o.plannedQuoteUsdt,
    o.filledQuoteUsdt, o.remainingQuoteUsdt, o.status,
    new Date(o.createdAt).toISOString(), new Date(o.updatedAt).toISOString(), o.lastError ?? "",
  ]);
  return "\\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\\r\\n");
}

export async function downloadQueuedOrdersCsv(): Promise<void> {
  if (typeof document === "undefined" || typeof URL === "undefined") throw new Error("CSV 导出只能在浏览器中执行");
  const csv = queuedOrdersToCsv(await listQueuedOrders());
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "待买入订单.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}
