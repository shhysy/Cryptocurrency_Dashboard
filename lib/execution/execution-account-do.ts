import {
  validateServerExecutionIntent,
  type ServerExecutionIntent,
} from "./server-execution-core";

interface SqlCursor {
  toArray(): unknown[];
}

interface SqlStorage {
  exec(query: string, ...bindings: unknown[]): SqlCursor;
}

interface DurableStorage {
  sql: SqlStorage;
  getAlarm(): Promise<number | null>;
  setAlarm(timestamp: number): Promise<void>;
  transactionSync<T>(callback: () => T): T;
}

function decimalUnits(value: string): { units: bigint; scale: number } | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return { units: BigInt(whole + fraction), scale: fraction.length };
}

function compareDecimalStrings(left: string, right: string): number | null {
  const a = decimalUnits(left);
  const b = decimalUnits(right);
  if (!a || !b) return null;
  const scale = Math.max(a.scale, b.scale);
  const leftUnits = a.units * 10n ** BigInt(scale - a.scale);
  const rightUnits = b.units * 10n ** BigInt(scale - b.scale);
  return leftUnits < rightUnits ? -1 : leftUnits > rightUnits ? 1 : 0;
}

interface DurableObjectStateLike {
  storage: DurableStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

/**
 * 单个Binance账户的SQLite持久化协调器基础层。
 * 本阶段只提供幂等订单意图落库、审计和调度心跳，不执行任何交易请求。
 */
export class ExecutionAccountDO {
  private readonly state: DurableObjectStateLike;
  private readonly ready: Promise<void>;

  constructor(state: DurableObjectStateLike, _env: unknown) {
    this.state = state;
    this.ready = state.blockConcurrencyWhile(async () => {
      this.initializeSchema();
    });
  }

  private initializeSchema(): void {
    const sql = this.state.storage.sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS account_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS order_intents (
        intent_id TEXT PRIMARY KEY,
        strategy_event_id TEXT NOT NULL UNIQUE,
        strategy_version TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
        quote_asset TEXT NOT NULL,
        amount TEXT NOT NULL,
        state TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        exchange_order_id TEXT,
        client_order_id TEXT,
        exchange_terminal_at INTEGER,
        fills_reconciled_at INTEGER,
        last_error TEXT
      )
    `);
    sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_order_intents_state_created
      ON order_intents(state, created_at)
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS order_attempts (
        attempt_id TEXT PRIMARY KEY,
        intent_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        client_order_id TEXT NOT NULL UNIQUE,
        lease_token TEXT NOT NULL,
        state TEXT NOT NULL,
        exchange_order_id TEXT,
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(intent_id, attempt)
      )
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS reservations (
        reservation_id TEXT PRIMARY KEY,
        intent_id TEXT NOT NULL,
        asset TEXT NOT NULL,
        amount TEXT NOT NULL,
        consumed_amount TEXT NOT NULL DEFAULT '0',
        attempt INTEGER NOT NULL,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS account_lock (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        intent_id TEXT NOT NULL UNIQUE,
        attempt INTEGER NOT NULL,
        lease_token TEXT NOT NULL,
        lease_until INTEGER NOT NULL,
        asset TEXT NOT NULL,
        reserved_amount TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS fills (
        symbol TEXT NOT NULL,
        trade_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        qty TEXT NOT NULL,
        quote_qty TEXT NOT NULL,
        commission TEXT NOT NULL,
        commission_asset TEXT NOT NULL,
        filled_at INTEGER NOT NULL,
        PRIMARY KEY(symbol, trade_id)
      )
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS audit_events (
        audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
        intent_id TEXT,
        event_type TEXT NOT NULL,
        payload_hash TEXT,
        created_at INTEGER NOT NULL
      )
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS scheduler_tasks (
        task_id TEXT PRIMARY KEY,
        task_type TEXT NOT NULL,
        due_at INTEGER NOT NULL,
        state TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_scheduler_tasks_due
      ON scheduler_tasks(state, due_at)
    `);
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);

    if (url.pathname === "/internal/health" && request.method === "GET") {
      const rows = this.state.storage.sql.exec(
        "SELECT COUNT(*) AS total FROM order_intents",
      ).toArray();
      return Response.json({
        ok: true,
        storage: "sqlite",
        intentCount: rows[0] && typeof rows[0] === "object"
          ? (rows[0] as { total?: number }).total ?? 0
          : 0,
      });
    }

    if (url.pathname === "/internal/watchdog" && request.method === "POST") {
      const now = Date.now();
      this.state.storage.sql.exec(
        `INSERT INTO account_metadata(key, value, updated_at)
         VALUES ('last_watchdog_at', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        String(now),
        now,
      );
      const currentAlarm = await this.state.storage.getAlarm();
      if (currentAlarm === null || currentAlarm <= now) {
        await this.state.storage.setAlarm(now + 5 * 60_000);
      }
      return Response.json({ ok: true, watchdogAt: now });
    }

    if (url.pathname === "/internal/intents" && request.method === "POST") {
      const contentLength = Number(request.headers.get("content-length") ?? 0);
      if (contentLength > 16_384) {
        return Response.json({ error: "订单意图请求体过大" }, { status: 413 });
      }

      let rawBody: string;
      try {
        rawBody = await request.text();
      } catch {
        return Response.json({ error: "订单意图请求体读取失败" }, { status: 400 });
      }
      if (new TextEncoder().encode(rawBody).byteLength > 16_384) {
        return Response.json({ error: "订单意图请求体过大" }, { status: 413 });
      }

      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        return Response.json({ error: "订单意图JSON格式无效" }, { status: 400 });
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return Response.json({ error: "订单意图格式无效" }, { status: 400 });
      }

      const input = body as Record<string, unknown>;
      const candidate = {
        intentId: input.intentId,
        strategyEventId: input.strategyEventId,
        strategyVersion: input.strategyVersion,
        symbol: input.symbol,
        side: input.side,
        quoteAsset: input.quoteAsset,
        amount: input.amount,
        createdAt: input.createdAt,
      };
      const validationError = validateServerExecutionIntent(
        candidate as unknown as Parameters<typeof validateServerExecutionIntent>[0],
      );
      if (validationError) {
        return Response.json({ error: validationError }, { status: 400 });
      }

      const now = Date.now();
      const intent = {
        intentId: candidate.intentId as string,
        strategyEventId: candidate.strategyEventId as string,
        strategyVersion: "3.3" as const,
        symbol: candidate.symbol as string,
        side: candidate.side as "BUY" | "SELL",
        quoteAsset: "USDT" as const,
        amount: candidate.amount as string,
        state: "queued" as const,
        attempt: 0,
        createdAt: candidate.createdAt as number,
        updatedAt: now,
        exchangeOrderId: null,
        clientOrderId: null,
        exchangeTerminalAt: null,
        fillsReconciledAt: null,
        lastError: null,
      } satisfies ServerExecutionIntent;

      const inserted = this.state.storage.sql.exec(
        `INSERT INTO order_intents (
          intent_id, strategy_event_id, strategy_version, symbol, side,
          quote_asset, amount, state, attempt, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
        RETURNING intent_id`,
        intent.intentId,
        intent.strategyEventId,
        intent.strategyVersion,
        intent.symbol,
        intent.side,
        intent.quoteAsset,
        intent.amount,
        intent.state,
        intent.attempt,
        intent.createdAt,
        intent.updatedAt,
      ).toArray();

      if (inserted.length > 0) {
        this.state.storage.sql.exec(
          "INSERT INTO audit_events(intent_id, event_type, created_at) VALUES (?, 'intent_created', ?)",
          intent.intentId,
          now,
        );
      }

      const existing = this.state.storage.sql.exec(
        "SELECT intent_id, state, strategy_event_id FROM order_intents WHERE intent_id = ?",
        intent.intentId,
      ).toArray();
      const existingRow = existing[0] as { intent_id?: string; state?: string; strategy_event_id?: string } | undefined;
      if (!existingRow || existingRow.strategy_event_id !== intent.strategyEventId) {
        return Response.json({ error: "订单意图幂等冲突，已拒绝覆盖" }, { status: 409 });
      }

      return Response.json({
        accepted: true,
        created: inserted.length > 0,
        intentId: existingRow.intent_id,
        state: existingRow.state,
      }, { status: inserted.length > 0 ? 201 : 200 });
    }

    if (url.pathname === "/internal/claim" && request.method === "POST") {
      let body: unknown;
      try {
        const rawBody = await request.text();
        if (new TextEncoder().encode(rawBody).byteLength > 16_384) {
          return Response.json({ error: "订单领取请求体过大" }, { status: 413 });
        }
        body = JSON.parse(rawBody);
      } catch {
        return Response.json({ error: "订单领取请求体无效" }, { status: 400 });
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return Response.json({ error: "订单领取参数无效" }, { status: 400 });
      }

      const input = body as Record<string, unknown>;
      const intentId = typeof input.intentId === "string" ? input.intentId : "";
      const asset = typeof input.asset === "string" ? input.asset : "";
      const availableBalance = typeof input.availableBalance === "string" ? input.availableBalance : "";
      const snapshotAt = input.snapshotAt;
      const now = Date.now();
      if (!intentId || !/^[A-Z0-9]{2,12}$/.test(asset) ||
          !Number.isSafeInteger(snapshotAt) || (snapshotAt as number) <= 0 ||
          (snapshotAt as number) > now + 5_000 || now - (snapshotAt as number) > 60_000 ||
          compareDecimalStrings(availableBalance, "0") === null ||
          compareDecimalStrings(availableBalance, "0")! <= 0) {
        return Response.json({ error: "余额快照或资产字段无效/已过期" }, { status: 400 });
      }

      try {
        const claimed = this.state.storage.transactionSync(() => {
          const sql = this.state.storage.sql;
          const rows = sql.exec(
            "SELECT intent_id, symbol, side, amount, state, attempt FROM order_intents WHERE intent_id = ?",
            intentId,
          ).toArray();
          const row = rows[0] as {
            intent_id?: string; symbol?: string; side?: string; amount?: string;
            state?: string; attempt?: number;
          } | undefined;
          if (!row || !row.symbol || !row.side || !row.amount) {
            throw new Error("找不到可领取的订单意图");
          }
          if (row.state !== "queued") throw new Error("订单意图不处于queued状态，拒绝重复领取");
          const expectedAsset = row.side === "BUY" ? "USDT" : row.symbol.slice(0, -4);
          if (!row.symbol.endsWith("USDT") || asset !== expectedAsset) {
            throw new Error("预留资产与订单方向/交易对不匹配");
          }
          if (compareDecimalStrings(availableBalance, row.amount) === null ||
              compareDecimalStrings(availableBalance, row.amount)! < 0) {
            throw new Error("账户可用余额不足，未创建资金预留");
          }
          const lockRows = sql.exec(
            "SELECT intent_id FROM account_lock WHERE singleton = 1",
          ).toArray();
          if (lockRows.length > 0) throw new Error("账户已有活动订单锁，拒绝并发领取");

          const attempt = Number(row.attempt ?? 0) + 1;
          if (!Number.isSafeInteger(attempt) || attempt <= 0) {
            throw new Error("订单attempt计数无效");
          }
          const leaseToken = crypto.randomUUID();
          const clientOrderId = `gpt${attempt}${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
          const leaseUntil = now + 30_000;
          const updated = sql.exec(
            `UPDATE order_intents
             SET state = 'reserved', attempt = ?, client_order_id = ?, updated_at = ?
             WHERE intent_id = ? AND state = 'queued'
             RETURNING intent_id`,
            attempt, clientOrderId, now, intentId,
          ).toArray();
          if (updated.length !== 1) throw new Error("订单意图状态已变化，领取失败");

          sql.exec(
            `INSERT INTO reservations(
              reservation_id, intent_id, asset, amount, consumed_amount,
              attempt, state, created_at, updated_at
            ) VALUES (?, ?, ?, ?, '0', ?, 'reserved', ?, ?)`,
            `${intentId}:${attempt}:${asset}`, intentId, asset, row.amount, attempt, now, now,
          );
          sql.exec(
            `INSERT INTO order_attempts(
              attempt_id, intent_id, attempt, client_order_id, lease_token,
              state, started_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?)`,
            `${intentId}:${attempt}`, intentId, attempt, clientOrderId, leaseToken, now, now,
          );
          sql.exec(
            `INSERT INTO account_lock(
              singleton, intent_id, attempt, lease_token, lease_until,
              asset, reserved_amount, created_at, updated_at
            ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
            intentId, attempt, leaseToken, leaseUntil, asset, row.amount, now, now,
          );
          sql.exec(
            "INSERT INTO audit_events(intent_id, event_type, created_at) VALUES (?, 'intent_claimed_and_reserved', ?)",
            intentId, now,
          );
          return { intentId, attempt, clientOrderId, leaseToken, leaseUntil, asset, reservedAmount: row.amount };
        });
        return Response.json({ accepted: true, ...claimed }, { status: 201 });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "订单领取失败";
        return Response.json({ accepted: false, error: reason }, { status: 409 });
      }
    }

    return Response.json({ error: "内部执行协调器路径不存在" }, { status: 404 });
  }

  async alarm(): Promise<void> {
    await this.ready;
    const now = Date.now();
    this.state.storage.sql.exec(
      `INSERT INTO account_metadata(key, value, updated_at)
       VALUES ('last_alarm_at', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      String(now),
      now,
    );
  }
}
