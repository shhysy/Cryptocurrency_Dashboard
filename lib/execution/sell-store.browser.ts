export type SellEventStatus = "pending" | "reconcile_required" | "executed" | "blocked";

export interface SellEventRecord {
  eventKey: string;
  symbol: string;
  kind: string;
  status: SellEventStatus;
  requestedQty: number;
  createdAt: number;
  updatedAt: number;
  exchangeOrderId: string | null;
  fillIds: string[];
  lastError: string | null;
}

const DB_NAME = "long-term-investment-sell-events";
const DB_VERSION = 1;
const STORE = "sell-events";

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("当前环境不支持 IndexedDB"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "eventKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("打开卖出事件数据库失败"));
  });
}

/** Atomic claim: a duplicate event from another tab cannot create a second sell intent. */
export async function reserveSellEvent(record: SellEventRecord): Promise<{ record: SellEventRecord; created: boolean }> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const get = store.get(record.eventKey);
      let result = { record, created: false };
      get.onsuccess = () => {
        if (get.result) result = { record: get.result as SellEventRecord, created: false };
        else {
          store.add(record);
          result = { record, created: true };
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error("预留卖出事件失败"));
      tx.onabort = () => reject(tx.error ?? new Error("卖出事件事务中止"));
    });
  } finally {
    db.close();
  }
}

export async function updateSellEvent(record: SellEventRecord): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("更新卖出事件失败"));
      tx.onabort = () => reject(tx.error ?? new Error("卖出事件更新事务中止"));
    });
  } finally {
    db.close();
  }
}

export async function listSellEvents(): Promise<SellEventRecord[]> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve((request.result as SellEventRecord[]).sort((a, b) => a.createdAt - b.createdAt));
      request.onerror = () => reject(request.error ?? new Error("读取卖出事件失败"));
    });
  } finally {
    db.close();
  }
}
