import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

export const LOCAL_EXECUTION_SCHEMA_VERSION = 3;

const INITIAL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS order_intents (
    intent_id TEXT PRIMARY KEY,
    strategy_event_id TEXT NOT NULL UNIQUE,
    strategy_version TEXT NOT NULL CHECK (strategy_version = '3.3'),
    symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    quote_asset TEXT NOT NULL CHECK (quote_asset = 'USDT'),
    amount TEXT NOT NULL,
    state TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    exchange_order_id TEXT,
    client_order_id TEXT UNIQUE,
    exchange_terminal_at INTEGER,
    fills_reconciled_at INTEGER,
    last_error TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_order_intents_state_created
    ON order_intents(state, created_at)`,
  `CREATE TABLE IF NOT EXISTS order_attempts (
    attempt_id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL REFERENCES order_intents(intent_id),
    attempt INTEGER NOT NULL CHECK (attempt > 0),
    client_order_id TEXT NOT NULL UNIQUE,
    lease_token TEXT NOT NULL,
    lease_until INTEGER NOT NULL,
    state TEXT NOT NULL,
    exchange_order_id TEXT,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(intent_id, attempt)
  )`,
  `CREATE TABLE IF NOT EXISTS exchange_orders (
    exchange_order_id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL REFERENCES order_intents(intent_id),
    attempt INTEGER NOT NULL,
    client_order_id TEXT NOT NULL UNIQUE,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    status TEXT NOT NULL,
    orig_qty TEXT NOT NULL,
    executed_qty TEXT NOT NULL,
    cumulative_quote_qty TEXT NOT NULL,
    exchange_time INTEGER,
    exchange_update_time INTEGER,
    reconciled_at INTEGER NOT NULL,
    UNIQUE(intent_id, attempt)
  )`,
  `CREATE TABLE IF NOT EXISTS reservations (
    reservation_id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL REFERENCES order_intents(intent_id),
    asset TEXT NOT NULL,
    amount TEXT NOT NULL,
    consumed_amount TEXT NOT NULL DEFAULT '0',
    attempt INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('reserved', 'settled', 'manual_review')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(intent_id, attempt)
  )`,
  `CREATE TABLE IF NOT EXISTS account_lock (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    intent_id TEXT NOT NULL UNIQUE REFERENCES order_intents(intent_id),
    attempt INTEGER NOT NULL,
    lease_token TEXT NOT NULL,
    lease_until INTEGER NOT NULL,
    asset TEXT NOT NULL,
    reserved_amount TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS fills (
    symbol TEXT NOT NULL,
    trade_id TEXT NOT NULL,
    intent_id TEXT REFERENCES order_intents(intent_id),
    attempt INTEGER,
    order_id TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    price TEXT NOT NULL,
    qty TEXT NOT NULL,
    quote_qty TEXT NOT NULL,
    commission TEXT NOT NULL,
    commission_asset TEXT NOT NULL,
    commission_usdt TEXT NOT NULL,
    filled_at INTEGER NOT NULL,
    sell_kind TEXT,
    PRIMARY KEY(symbol, trade_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_fills_intent_attempt
    ON fills(intent_id, attempt, order_id)`,
  `CREATE TABLE IF NOT EXISTS trade_ledger (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    fill_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    time INTEGER NOT NULL,
    price REAL NOT NULL,
    qty REAL NOT NULL,
    quote_qty REAL NOT NULL,
    commission REAL NOT NULL,
    commission_asset TEXT NOT NULL,
    commission_usdt REAL NOT NULL,
    realized_pnl_usdt REAL,
    sell_kind TEXT,
    base_ratio_at_buy REAL,
    UNIQUE(symbol, fill_id)
  )`,
  `CREATE TABLE IF NOT EXISTS buy_orders (
    id TEXT PRIMARY KEY,
    event_key TEXT NOT NULL UNIQUE,
    symbol TEXT NOT NULL,
    quote_asset TEXT NOT NULL,
    strategy_label TEXT NOT NULL,
    planned_usdt REAL NOT NULL,
    reference_price REAL NOT NULL,
    base_ratio_at_signal REAL NOT NULL,
    strategy_version TEXT NOT NULL,
    status TEXT NOT NULL,
    filled_usdt REAL NOT NULL,
    remaining_usdt REAL NOT NULL,
    attempt_count INTEGER NOT NULL,
    last_attempt_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sell_events (
    event_key TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'reconcile_required', 'partially_filled', 'executed', 'blocked')),
    requested_qty REAL NOT NULL,
    filled_qty REAL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    exchange_order_id TEXT,
    client_order_id TEXT UNIQUE,
    fill_ids_json TEXT NOT NULL DEFAULT '[]',
    last_error TEXT,
    exchange_terminal_status TEXT,
    fill_reconcile_completed_at INTEGER,
    lot_step_size REAL
  )`,
  `CREATE TABLE IF NOT EXISTS scheduler_tasks (
    task_id TEXT PRIMARY KEY,
    task_type TEXT NOT NULL CHECK (task_type IN ('reconcile_intent', 'health_check')),
    due_at INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'leased', 'completed', 'manual_review')),
    attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    lease_token TEXT,
    lease_until INTEGER,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_scheduler_tasks_due
    ON scheduler_tasks(state, due_at, next_attempt_at, lease_until)`,
  `CREATE TABLE IF NOT EXISTS notification_outbox (
    id TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'leased', 'sent', 'manual_review')),
    attempt INTEGER NOT NULL DEFAULT 0,
    lease_token TEXT,
    lease_until INTEGER,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
    intent_id TEXT,
    event_type TEXT NOT NULL,
    payload_hash TEXT,
    created_at INTEGER NOT NULL
  )`,
];

export interface LocalExecutionDatabaseOptions {
  /** 默认 data/trader.db；测试可传入临时目录中的数据库路径。 */
  path?: string;
  /** 数据库忙时等待毫秒数。 */
  busyTimeoutMs?: number;
}

export class LocalExecutionDatabase {
  readonly path: string;
  private readonly database: DatabaseSync;
  private closed = false;

  private constructor(path: string, database: DatabaseSync) {
    this.path = path;
    this.database = database;
  }

  static async open(options: LocalExecutionDatabaseOptions = {}): Promise<LocalExecutionDatabase> {
    const path = resolve(options.path ?? "data/trader.db");
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const database = new DatabaseSync(path);
    try {
      database.exec("PRAGMA foreign_keys = ON");
      database.exec("PRAGMA journal_mode = WAL");
      database.exec("PRAGMA synchronous = FULL");
      const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
      if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 60_000) {
        throw new Error("SQLite busy_timeout 配置无效");
      }
      database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
      const store = new LocalExecutionDatabase(path, database);
      store.migrate();
      await chmod(path, 0o600);
      return store;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("本地执行数据库已经关闭");
  }

  private migrate(): void {
    this.assertOpen();
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);
    const row = this.database.prepare(
      "SELECT MAX(version) AS version FROM schema_migrations",
    ).get() as { version?: number | null } | undefined;
    const currentVersion = Number(row?.version ?? 0);
    if (currentVersion > LOCAL_EXECUTION_SCHEMA_VERSION) {
      throw new Error("本地执行数据库版本高于当前程序，拒绝降级启动");
    }
    if (currentVersion < 1) {
      this.transaction(() => {
        for (const statement of INITIAL_SCHEMA) this.database.exec(statement);
        this.database.prepare(
          "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
        ).run(1, Date.now());
      });
    }
    if (currentVersion < 2) {
      this.transaction(() => {
        this.database.exec("ALTER TABLE order_intents ADD COLUMN base_ratio_at_signal REAL");
        this.database.prepare(
          "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
        ).run(2, Date.now());
      });
    }
    if (currentVersion < 3) {
      this.transaction(() => {
        this.database.exec("ALTER TABLE exchange_orders RENAME COLUMN orig_qty TO requested_amount");
        this.database.prepare(
          "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
        ).run(3, Date.now());
      });
    }
  }

  exec(sql: string): void {
    this.assertOpen();
    this.database.exec(sql);
  }

  prepare(sql: string): StatementSync {
    this.assertOpen();
    return this.database.prepare(sql);
  }

  /**
   * 同步原子事务。拒绝async回调，避免await期间释放SQLite事务锁或执行网络IO。
   */
  transaction<T>(work: () => T): T {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      if (result !== null && (typeof result === "object" || typeof result === "function") &&
          "then" in result && typeof (result as { then?: unknown }).then === "function") {
        throw new Error("SQLite事务回调必须同步完成，禁止await或网络IO");
      }
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* 保留最初的事务异常 */ }
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }
}

export async function openLocalExecutionDatabase(
  options: LocalExecutionDatabaseOptions = {},
): Promise<LocalExecutionDatabase> {
  return LocalExecutionDatabase.open(options);
}
