import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openLocalExecutionDatabase } from "./sqlite-database";

const temporaryDirectories: string[] = [];

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cryptodash-local-sqlite-"));
  temporaryDirectories.push(directory);
  return join(directory, "data", "trader.db");
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe("本地执行SQLite数据库基础设施", () => {
  it("首次打开会建立完整业务表和版本记录", async () => {
    const database = await openLocalExecutionDatabase({ path: await databasePath() });
    try {
      const tables = database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      ).all() as Array<{ name: string }>;
      const names = new Set(tables.map((row) => row.name));
      for (const name of [
        "schema_migrations", "order_intents", "order_attempts", "exchange_orders",
        "reservations", "account_lock", "fills", "trade_ledger", "buy_orders",
        "sell_events", "scheduler_tasks", "notification_outbox", "audit_events",
      ]) {
        expect(names.has(name), `缺少SQLite表：${name}`).toBe(true);
      }
      const version = database.prepare(
        "SELECT MAX(version) AS version FROM schema_migrations",
      ).get() as { version: number };
      expect(version.version).toBe(4);
      const foreignKeys = database.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
      expect(foreignKeys.foreign_keys).toBe(1);
    } finally {
      database.close();
    }
  });

  it("重复打开数据库不会重复建表或丢失已写数据", async () => {
    const path = await databasePath();
    const first = await openLocalExecutionDatabase({ path });
    first.prepare(
      "INSERT INTO audit_events(event_type, created_at) VALUES (?, ?)",
    ).run("test_persist", 123);
    first.close();

    const second = await openLocalExecutionDatabase({ path });
    try {
      const row = second.prepare(
        "SELECT event_type, created_at FROM audit_events WHERE event_type = ?",
      ).get("test_persist") as { event_type: string; created_at: number };
      expect(row).toEqual({ event_type: "test_persist", created_at: 123 });
      const versions = second.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get() as { total: number };
      expect(versions.total).toBe(4);
    } finally {
      second.close();
    }
  });

  it("旧版v1数据库会升级并保留订单表数据", async () => {
    const path = await databasePath();
    await import("node:fs/promises").then(({ mkdir }) => mkdir(join(path, ".."), { recursive: true }));
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      INSERT INTO schema_migrations(version, applied_at) VALUES (1, 100);
      CREATE TABLE order_intents (
        intent_id TEXT PRIMARY KEY,
        strategy_event_id TEXT NOT NULL UNIQUE,
        strategy_version TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        quote_asset TEXT NOT NULL,
        amount TEXT NOT NULL,
        state TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        exchange_order_id TEXT,
        client_order_id TEXT UNIQUE,
        exchange_terminal_at INTEGER,
        fills_reconciled_at INTEGER,
        last_error TEXT
      );
      CREATE TABLE exchange_orders (
        exchange_order_id TEXT PRIMARY KEY,
        intent_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        client_order_id TEXT NOT NULL UNIQUE,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        status TEXT NOT NULL,
        orig_qty TEXT NOT NULL,
        executed_qty TEXT NOT NULL,
        cumulative_quote_qty TEXT NOT NULL,
        exchange_time INTEGER,
        exchange_update_time INTEGER,
        reconciled_at INTEGER NOT NULL
      );
      INSERT INTO order_intents(
        intent_id, strategy_event_id, strategy_version, symbol, side, quote_asset,
        amount, state, attempt, created_at, updated_at
      ) VALUES ('v33:BTC:head:2026W47', 'BTC:head:2026W47', '3.3', 'BTCUSDT',
        'BUY', 'USDT', '100', 'queued', 0, 100, 100);
    `);
    legacy.close();

    const upgraded = await openLocalExecutionDatabase({ path });
    try {
      const columns = upgraded.prepare("PRAGMA table_info(order_intents)").all() as Array<{ name: string }>;
      expect(columns.some((column) => column.name === "base_ratio_at_signal")).toBe(true);
      expect(columns.some((column) => column.name === "strategy_tier")).toBe(true);
      const intent = upgraded.prepare("SELECT amount FROM order_intents WHERE intent_id = ?")
        .get("v33:BTC:head:2026W47") as { amount: string };
      expect(intent.amount).toBe("100");
      const version = upgraded.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number };
      expect(version.version).toBe(4);
    } finally {
      upgraded.close();
    }
  });

  it("同步事务异常时完整回滚", async () => {
    const database = await openLocalExecutionDatabase({ path: await databasePath() });
    try {
      expect(() => database.transaction(() => {
        database.prepare(
          "INSERT INTO audit_events(event_type, created_at) VALUES (?, ?)",
        ).run("must_rollback", 456);
        throw new Error("模拟事务中途失败");
      })).toThrow("模拟事务中途失败");
      const row = database.prepare(
        "SELECT COUNT(*) AS total FROM audit_events WHERE event_type = ?",
      ).get("must_rollback") as { total: number };
      expect(row.total).toBe(0);
    } finally {
      database.close();
    }
  });

  it("拒绝async事务回调，防止await期间持有SQLite事务", async () => {
    const database = await openLocalExecutionDatabase({ path: await databasePath() });
    try {
      expect(() => database.transaction(() => Promise.resolve("不允许"))).toThrow("必须同步完成");
      const row = database.prepare("SELECT COUNT(*) AS total FROM audit_events").get() as { total: number };
      expect(row.total).toBe(0);
    } finally {
      database.close();
    }
  });

  it("关闭后拒绝继续访问", async () => {
    const database = await openLocalExecutionDatabase({ path: await databasePath() });
    database.close();
    expect(() => database.prepare("SELECT 1")).toThrow("已经关闭");
  });
});
