import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SellEventRecord } from "../sell-store.browser";
import type { TradeLedgerEntry } from "../types";

export interface TraderStatusSnapshot {
  generatedAt: number;
  mode: "off" | "dry-run" | "testnet" | "production" | "unknown";
  stopRequested: boolean;
  trader: {
    state: "running" | "heartbeat_stale" | "stale_lock" | "stopped" | "invalid_lock";
    pid: number | null;
    startedAt: number | null;
    heartbeatAt: number | null;
  };
  database: {
    available: boolean;
    reason?: string;
    counts: {
      intents: number;
      buysOpen: number;
      sellsOpen: number;
      manualReview: number;
      reservations: number;
      notificationsPending: number;
      fills: number;
    };
    intents: Array<{
      id: string;
      symbol: string;
      side: "BUY" | "SELL";
      amount: string;
      state: string;
      updatedAt: number;
    }>;
    sells: Array<{
      eventKey: string;
      symbol: string;
      kind: string;
      status: string;
      requestedQty: number;
      filledQty: number | null;
      updatedAt: number;
    }>;
    fills: Array<{
      id: string;
      symbol: string;
      side: "BUY" | "SELL";
      price: number;
      qty: number;
      quoteQty: number;
      time: number;
      realizedPnlUsdt: number | null;
    }>;
    notificationStates: Record<string, number>;
  };
}

interface LockPayload {
  pid: number;
  startedAt: number;
  heartbeatAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseLock(raw: string): LockPayload | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) ||
        !Number.isSafeInteger(value.pid) || Number(value.pid) <= 0 ||
        !Number.isSafeInteger(value.startedAt) ||
        !Number.isSafeInteger(value.heartbeatAt)) return null;
    return {
      pid: Number(value.pid),
      startedAt: Number(value.startedAt),
      heartbeatAt: Number(value.heartbeatAt),
    };
  } catch {
    return null;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function readTraderLock(path: string): Promise<{
  state: TraderStatusSnapshot["trader"]["state"];
  pid: number | null;
  startedAt: number | null;
  heartbeatAt: number | null;
}> {
  try {
    const lock = parseLock(await readFile(path, "utf8"));
    if (!lock) return { state: "invalid_lock", pid: null, startedAt: null, heartbeatAt: null };
    const alive = processIsAlive(lock.pid);
    const fresh = Date.now() - lock.heartbeatAt <= 45_000;
    const state = alive && fresh ? "running"
      : alive ? "heartbeat_stale"
      : "stale_lock";
    return { state, pid: lock.pid, startedAt: lock.startedAt, heartbeatAt: lock.heartbeatAt };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { state: "stopped", pid: null, startedAt: null, heartbeatAt: null };
    }
    return { state: "invalid_lock", pid: null, startedAt: null, heartbeatAt: null };
  }
}

function count(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as { total?: number | bigint } | undefined;
  return Number(row?.total ?? 0);
}

/**
 * 只读读取本地Trader SQLite快照。
 * 不创建数据库、不迁移schema、不写入任何执行状态，也不返回Key、签名或锁token。
 */
export async function readTraderStatusSnapshot(options: {
  dbPath?: string;
  lockPath?: string;
  stopPath?: string;
  mode?: string;
} = {}): Promise<TraderStatusSnapshot> {
  const dbPath = resolve(options.dbPath ?? process.env.TRADER_DB_PATH ?? "data/trader.db");
  const lockPath = resolve(options.lockPath ?? process.env.TRADER_LOCK_PATH ?? "data/trader.lock");
  const stopPath = resolve(options.stopPath ?? "data/STOP");
  const [trader, stopFile, dbStat] = await Promise.all([
    readTraderLock(lockPath),
    stat(stopPath).then(() => true).catch((error) =>
      (error as NodeJS.ErrnoException).code === "ENOENT" ? false : true
    ),
    stat(dbPath).catch(() => null),
  ]);

  const modeValue = options.mode ?? process.env.AUTO_TRADE_MODE ?? "off";
  const mode = modeValue === "off" || modeValue === "dry-run" ||
    modeValue === "testnet" || modeValue === "production" ? modeValue : "unknown";

  const base: TraderStatusSnapshot = {
    generatedAt: Date.now(),
    mode,
    stopRequested: stopFile,
    trader,
    database: {
      available: false,
      reason: "Trader数据库尚未创建；请先启动本地Trader",
      counts: {
        intents: 0, buysOpen: 0, sellsOpen: 0, manualReview: 0,
        reservations: 0, notificationsPending: 0, fills: 0,
      },
      intents: [],
      sells: [],
      fills: [],
      notificationStates: {},
    },
  };
  if (!dbStat?.isFile()) return base;

  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec("PRAGMA query_only = ON");
    const intents = db.prepare(
      `SELECT intent_id, symbol, side, amount, state, updated_at
       FROM order_intents ORDER BY updated_at DESC LIMIT 20`,
    ).all() as Array<Record<string, unknown>>;
    const sells = db.prepare(
      `SELECT event_key, symbol, kind, status, requested_qty, filled_qty, updated_at
       FROM sell_events ORDER BY updated_at DESC LIMIT 20`,
    ).all() as Array<Record<string, unknown>>;
    const fills = db.prepare(
      `SELECT id, symbol, side, price, qty, quote_qty, time, realized_pnl_usdt
       FROM trade_ledger ORDER BY time DESC LIMIT 20`,
    ).all() as Array<Record<string, unknown>>;
    const notificationRows = db.prepare(
      "SELECT state, COUNT(*) AS total FROM notification_outbox GROUP BY state",
    ).all() as Array<{ state: string; total: number | bigint }>;

    const intentRows = db.prepare(
      "SELECT side, state, COUNT(*) AS total FROM order_intents GROUP BY side, state",
    ).all() as Array<{ side: string; state: string; total: number | bigint }>;
    const sellRows = db.prepare(
      "SELECT status, COUNT(*) AS total FROM sell_events GROUP BY status",
    ).all() as Array<{ status: string; total: number | bigint }>;

    const intentCount = intentRows.reduce((sum, row) => sum + Number(row.total), 0);
    const buysOpen = intentRows.filter((row) => row.side === "BUY" &&
      ["queued", "reserved", "submitting", "unknown", "reconciling", "partially_filled"].includes(row.state))
      .reduce((sum, row) => sum + Number(row.total), 0);
    const sellsOpen = sellRows.filter((row) =>
      ["pending", "reconcile_required", "partially_filled"].includes(row.status))
      .reduce((sum, row) => sum + Number(row.total), 0);
    const notificationStates = Object.fromEntries(
      notificationRows.map((row) => [row.state, Number(row.total)]),
    );
    const manualReview = intentRows.filter((row) => row.state === "manual_review")
      .reduce((sum, row) => sum + Number(row.total), 0) +
      sellRows.filter((row) => row.status === "blocked")
        .reduce((sum, row) => sum + Number(row.total), 0) +
      count(db, "SELECT COUNT(*) AS total FROM reservations WHERE state = 'manual_review'") +
      (notificationStates.manual_review ?? 0);

    base.database = {
      available: true,
      counts: {
        intents: intentCount,
        buysOpen,
        sellsOpen,
        manualReview,
        reservations: count(db, "SELECT COUNT(*) AS total FROM reservations WHERE state IN ('reserved', 'manual_review')"),
        notificationsPending: (notificationStates.pending ?? 0) +
          (notificationStates.leased ?? 0) + (notificationStates.manual_review ?? 0),
        fills: count(db, "SELECT COUNT(*) AS total FROM trade_ledger"),
      },
      intents: intents.map((row) => ({
        id: String(row.intent_id),
        symbol: String(row.symbol),
        side: row.side === "SELL" ? "SELL" : "BUY",
        amount: String(row.amount),
        state: String(row.state),
        updatedAt: Number(row.updated_at),
      })),
      sells: sells.map((row) => ({
        eventKey: String(row.event_key),
        symbol: String(row.symbol),
        kind: String(row.kind),
        status: String(row.status),
        requestedQty: Number(row.requested_qty),
        filledQty: row.filled_qty == null ? null : Number(row.filled_qty),
        updatedAt: Number(row.updated_at),
      })),
      fills: fills.map((row) => ({
        id: String(row.id),
        symbol: String(row.symbol),
        side: row.side === "SELL" ? "SELL" : "BUY",
        price: Number(row.price),
        qty: Number(row.qty),
        quoteQty: Number(row.quote_qty),
        time: Number(row.time),
        realizedPnlUsdt: row.realized_pnl_usdt == null ? null : Number(row.realized_pnl_usdt),
      })),
      notificationStates,
    };
    delete base.database.reason;
    return base;
  } catch {
    return {
      ...base,
      database: { ...base.database, reason: "Trader数据库读取失败或结构不兼容；未返回不完整统计" },
    };
  } finally {
    db?.close();
  }
}


export interface TraderStrategyHistory {
  sellEvents: SellEventRecord[];
  tradeLedger: TradeLedgerEntry[];
}

/**
 * Loads the complete strategy replay history from the existing Trader DB.
 * A missing database is distinct from a damaged database: missing returns null;
 * any read/schema/row-integrity error throws so strategy execution can fail closed.
 */
export async function readTraderStrategyHistory(options: { dbPath?: string } = {}): Promise<TraderStrategyHistory | null> {
  const dbPath = resolve(options.dbPath ?? process.env.TRADER_DB_PATH ?? "data/trader.db");
  const file = await stat(dbPath).catch(() => null);
  if (!file?.isFile()) return null;

  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec("PRAGMA query_only = ON");
    const sellRows = db.prepare(
      `SELECT event_key, symbol, kind, status, requested_qty, filled_qty, created_at, updated_at,
              exchange_order_id, client_order_id, fill_ids_json, last_error,
              exchange_terminal_status, fill_reconcile_completed_at, lot_step_size
       FROM sell_events ORDER BY created_at ASC`,
    ).all() as Array<Record<string, unknown>>;
    const ledgerRows = db.prepare(
      `SELECT id, fill_id, order_id, symbol, side, time, price, qty, quote_qty,
              commission, commission_asset, commission_usdt, realized_pnl_usdt,
              sell_kind, base_ratio_at_buy
       FROM trade_ledger ORDER BY time ASC, id ASC`,
    ).all() as Array<Record<string, unknown>>;

    const sellEvents = sellRows.map((row): SellEventRecord => {
      let fillIds: unknown;
      try { fillIds = JSON.parse(String(row.fill_ids_json ?? "[]")); }
      catch { throw new Error("卖出事件成交ID JSON损坏"); }
      if (!Array.isArray(fillIds) || !fillIds.every((id) => typeof id === "string")) {
        throw new Error("卖出事件成交ID列表格式无效");
      }
      return {
        eventKey: String(row.event_key),
        symbol: String(row.symbol),
        kind: String(row.kind),
        status: String(row.status) as SellEventRecord["status"],
        requestedQty: Number(row.requested_qty),
        filledQty: row.filled_qty == null ? undefined : Number(row.filled_qty),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        exchangeOrderId: row.exchange_order_id == null ? null : String(row.exchange_order_id),
        clientOrderId: row.client_order_id == null ? undefined : String(row.client_order_id),
        fillIds: fillIds as string[],
        lastError: row.last_error == null ? null : String(row.last_error),
        exchangeTerminalStatus: row.exchange_terminal_status == null ? undefined : String(row.exchange_terminal_status),
        fillReconcileCompletedAt: row.fill_reconcile_completed_at == null ? undefined : Number(row.fill_reconcile_completed_at),
        lotStepSize: row.lot_step_size == null ? undefined : Number(row.lot_step_size),
      };
    });
    const tradeLedger = ledgerRows.map((row): TradeLedgerEntry => {
      if (row.side !== "BUY" && row.side !== "SELL") throw new Error("成交台账side字段无效");
      return {
        id: String(row.id),
        fillId: String(row.fill_id),
        orderId: String(row.order_id),
        symbol: String(row.symbol),
        side: row.side,
        time: Number(row.time),
        price: Number(row.price),
        qty: Number(row.qty),
        quoteQty: Number(row.quote_qty),
        commission: Number(row.commission),
        commissionAsset: String(row.commission_asset),
        commissionUsdt: Number(row.commission_usdt),
        realizedPnlUsdt: row.realized_pnl_usdt == null ? null : Number(row.realized_pnl_usdt),
        sellKind: row.sell_kind == null ? undefined : String(row.sell_kind) as TradeLedgerEntry["sellKind"],
        baseRatioAtBuy: row.base_ratio_at_buy == null ? undefined : Number(row.base_ratio_at_buy),
      };
    });
    if (sellEvents.some((event) =>
        !Number.isFinite(event.requestedQty) || event.requestedQty <= 0 ||
        !Number.isFinite(event.createdAt) || !Number.isFinite(event.updatedAt) ||
        (event.filledQty !== undefined && (!Number.isFinite(event.filledQty) ||
          event.filledQty < 0 || event.filledQty > event.requestedQty)) ||
        (["executed", "partially_filled"].includes(event.status) && event.fillIds.length === 0) ||
        (event.status === "partially_filled" && (!Number.isFinite(event.filledQty) || (event.filledQty ?? 0) <= 0))
      ) || tradeLedger.some((fill) =>
          ![fill.qty, fill.price, fill.time, fill.quoteQty, fill.commission, fill.commissionUsdt]
            .every(Number.isFinite) ||
          fill.qty <= 0 || fill.price <= 0 || fill.quoteQty <= 0 || fill.commission < 0 ||
          fill.commissionUsdt < 0)) {
      throw new Error("成交台账包含无效数值");
    }
    return { sellEvents, tradeLedger };
  } catch {
    throw new Error("本地Trader成交/卖出事件台账读取失败，已阻断策略后处理");
  } finally {
    db?.close();
  }
}
