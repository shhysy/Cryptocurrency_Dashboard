import {
  validateServerExecutionIntent,
  type ServerExecutionIntent,
} from "./server-execution-core";
import { expiredSchedulerLeaseDecision } from "./scheduler-task-core";

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
  deleteAlarm?(): Promise<void>;
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

function addDecimalStrings(values: string[]): string | null {
  const parsed = values.map(decimalUnits);
  if (parsed.some((value) => value === null)) return null;
  const scale = Math.max(0, ...parsed.map((value) => value!.scale));
  const total = parsed.reduce(
    (sum, value) => sum + value!.units * 10n ** BigInt(scale - value!.scale),
    0n,
  );
  const factor = 10n ** BigInt(scale);
  const whole = total / factor;
  const fraction = scale > 0
    ? (total % factor).toString().padStart(scale, "0").replace(/0+$/, "")
    : "";
  return fraction ? `${whole}.${fraction}` : String(whole);
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
        intent_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
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
      CREATE INDEX IF NOT EXISTS idx_fills_intent_attempt
      ON fills(intent_id, attempt, order_id)
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
        task_type TEXT NOT NULL CHECK (task_type IN ('reconcile_intent', 'health_check')),
        due_at INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'leased', 'completed', 'manual_review')),
        attempt INTEGER NOT NULL DEFAULT 0,
        lease_token TEXT,
        lease_until INTEGER,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    // 对已存在的旧版scheduler_tasks表做向前兼容迁移。
    // Cloudflare SQLite通过PRAGMA读取实际列，避免重复ALTER导致部署失败。
    const schedulerColumns = sql.exec("PRAGMA table_info(scheduler_tasks)").toArray()
      .map((row) => row && typeof row === "object"
        ? (row as { name?: unknown }).name
        : null)
      .filter((name): name is string => typeof name === "string");
    const existingColumns = new Set(schedulerColumns);
    const schedulerMigrations: Array<[string, string]> = [
      ["lease_token", "ALTER TABLE scheduler_tasks ADD COLUMN lease_token TEXT"],
      ["lease_until", "ALTER TABLE scheduler_tasks ADD COLUMN lease_until INTEGER"],
      ["next_attempt_at", "ALTER TABLE scheduler_tasks ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0"],
      ["last_error", "ALTER TABLE scheduler_tasks ADD COLUMN last_error TEXT"],
    ];
    for (const [column, statement] of schedulerMigrations) {
      if (!existingColumns.has(column)) sql.exec(statement);
    }
    sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_scheduler_tasks_due
      ON scheduler_tasks(state, next_attempt_at, due_at, lease_until)
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

    if (
      (url.pathname === "/internal/mark-submitting" || url.pathname === "/internal/mark-unknown" ||
       url.pathname === "/internal/takeover" || url.pathname === "/internal/renew-lease") &&
      request.method === "POST"
    ) {
      let input: Record<string, unknown>;
      try {
        const rawBody = await request.text();
        if (new TextEncoder().encode(rawBody).byteLength > 16_384) {
          return Response.json({ error: "租约请求体过大" }, { status: 413 });
        }
        const parsed: unknown = JSON.parse(rawBody);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return Response.json({ error: "租约请求参数无效" }, { status: 400 });
        }
        input = parsed as Record<string, unknown>;
      } catch {
        return Response.json({ error: "租约请求JSON无效" }, { status: 400 });
      }

      const intentId = typeof input.intentId === "string" ? input.intentId : "";
      const attempt = input.attempt;
      const leaseToken = typeof input.leaseToken === "string" ? input.leaseToken : "";
      if (!intentId || !Number.isSafeInteger(attempt) || (attempt as number) <= 0 || !leaseToken) {
        return Response.json({ error: "intentId、attempt或leaseToken无效" }, { status: 400 });
      }

      const now = Date.now();
      try {
        const result = this.state.storage.transactionSync(() => {
          const sql = this.state.storage.sql;
          const lockRows = sql.exec(
            "SELECT intent_id, attempt, lease_token, lease_until, asset, reserved_amount FROM account_lock WHERE singleton = 1",
          ).toArray();
          const lock = lockRows[0] as {
            intent_id?: string; attempt?: number; lease_token?: string; lease_until?: number;
          } | undefined;
          if (!lock || lock.intent_id !== intentId || lock.attempt !== attempt) {
            throw new Error("账户活动订单锁不存在或attempt不匹配");
          }

          const orderRows = sql.exec(
            "SELECT state, client_order_id, attempt FROM order_intents WHERE intent_id = ?",
            intentId,
          ).toArray();
          const order = orderRows[0] as {
            state?: string; client_order_id?: string; attempt?: number;
          } | undefined;
          if (!order || order.attempt !== attempt || !order.client_order_id) {
            throw new Error("订单attempt或clientOrderId不存在");
          }

          if (url.pathname === "/internal/takeover") {
            if (lock.lease_until === undefined || !Number.isSafeInteger(lock.lease_until) ||
                lock.lease_until > now) {
              throw new Error("当前租约尚未过期，不允许接管");
            }
            if (order.state !== "submitting" && order.state !== "unknown" && order.state !== "reconciling") {
              throw new Error("只有提交中/未知/对账中的订单允许接管，且接管仅用于查单对账");
            }
            const nextToken = crypto.randomUUID();
            const nextLeaseUntil = now + 30_000;
            const lockUpdated = sql.exec(
              `UPDATE account_lock
               SET lease_token = ?, lease_until = ?, updated_at = ?
               WHERE singleton = 1 AND intent_id = ? AND attempt = ?
                 AND lease_token = ? AND lease_until <= ?
               RETURNING intent_id`,
              nextToken, nextLeaseUntil, now, intentId, attempt, leaseToken, now,
            ).toArray();
            if (lockUpdated.length !== 1) throw new Error("租约已被其他执行者接管，拒绝覆盖");
            const attemptUpdated = sql.exec(
              "UPDATE order_attempts SET lease_token = ?, state = 'reconciling', updated_at = ? WHERE intent_id = ? AND attempt = ? AND lease_token = ? RETURNING attempt_id",
              nextToken, now, intentId, attempt, leaseToken,
            ).toArray();
            if (attemptUpdated.length !== 1) throw new Error("订单attempt租约已变化，拒绝接管");
            const intentUpdated = sql.exec(
              "UPDATE order_intents SET state = 'reconciling', updated_at = ? WHERE intent_id = ? AND attempt = ? AND state IN ('submitting', 'unknown', 'reconciling') RETURNING intent_id",
              now, intentId, attempt,
            ).toArray();
            if (intentUpdated.length !== 1) throw new Error("订单状态已变化，拒绝接管");
            sql.exec(
              "INSERT INTO audit_events(intent_id, event_type, created_at) VALUES (?, 'lease_taken_over_reconcile_only', ?)",
              intentId, now,
            );
            return {
              intentId, attempt, clientOrderId: order.client_order_id,
              leaseToken: nextToken, leaseUntil: nextLeaseUntil, reconcileOnly: true,
            };
          }

          if (lock.lease_token !== leaseToken || !Number.isSafeInteger(lock.lease_until) ||
              (lock.lease_until as number) <= now) {
            throw new Error("租约已过期或leaseToken不匹配；拒绝写入");
          }

          if (url.pathname === "/internal/renew-lease") {
            if (order.state !== "reserved" && order.state !== "submitting" &&
                order.state !== "unknown" && order.state !== "reconciling") {
              throw new Error("当前订单状态不允许续租");
            }
            const nextLeaseUntil = now + 30_000;
            const renewed = sql.exec(
              `UPDATE account_lock
               SET lease_until = ?, updated_at = ?
               WHERE singleton = 1 AND intent_id = ? AND attempt = ?
                 AND lease_token = ? AND lease_until > ?
               RETURNING intent_id`,
              nextLeaseUntil, now, intentId, attempt, leaseToken, now,
            ).toArray();
            if (renewed.length !== 1) throw new Error("租约已过期或已被接管，拒绝续租");
            sql.exec(
              "INSERT INTO audit_events(intent_id, event_type, created_at) VALUES (?, 'execution_lease_renewed', ?)",
              intentId, now,
            );
            return { intentId, attempt, leaseUntil: nextLeaseUntil, renewed: true };
          }

          if (url.pathname === "/internal/mark-submitting") {
            if (order.state !== "reserved") throw new Error("只有reserved订单允许进入submitting");
            const updated = sql.exec(
              "UPDATE order_intents SET state = 'submitting', updated_at = ? WHERE intent_id = ? AND attempt = ? AND state = 'reserved' RETURNING intent_id",
              now, intentId, attempt,
            ).toArray();
            if (updated.length !== 1) throw new Error("订单状态已变化，拒绝提交前写入");
            const attemptUpdated = sql.exec(
              "UPDATE order_attempts SET state = 'submitting', updated_at = ? WHERE intent_id = ? AND attempt = ? AND lease_token = ? RETURNING attempt_id",
              now, intentId, attempt, leaseToken,
            ).toArray();
            if (attemptUpdated.length !== 1) throw new Error("订单attempt租约不匹配，拒绝进入submitting");
            sql.exec(
              "INSERT INTO audit_events(intent_id, event_type, created_at) VALUES (?, 'intent_marked_submitting', ?)",
              intentId, now,
            );
            return { intentId, attempt, clientOrderId: order.client_order_id, state: "submitting" };
          }

          if (order.state !== "submitting" && order.state !== "reconciling") {
            throw new Error("只有submitting/reconciling订单允许标记unknown");
          }
          const intentUpdated = sql.exec(
            "UPDATE order_intents SET state = 'unknown', last_error = ?, updated_at = ? WHERE intent_id = ? AND attempt = ? AND state IN ('submitting', 'reconciling') RETURNING intent_id",
            typeof input.reason === "string" ? input.reason.slice(0, 500) : "提交结果不明确，等待按clientOrderId对账",
            now, intentId, attempt,
          ).toArray();
          if (intentUpdated.length !== 1) throw new Error("订单状态已变化，拒绝标记unknown");
          const attemptUpdated = sql.exec(
            "UPDATE order_attempts SET state = 'unknown', updated_at = ? WHERE intent_id = ? AND attempt = ? AND lease_token = ? RETURNING attempt_id",
            now, intentId, attempt, leaseToken,
          ).toArray();
          if (attemptUpdated.length !== 1) throw new Error("订单attempt租约不匹配，拒绝标记unknown");
          sql.exec(
            "INSERT INTO audit_events(intent_id, event_type, created_at) VALUES (?, 'intent_marked_unknown', ?)",
            intentId, now,
          );
          return { intentId, attempt, clientOrderId: order.client_order_id, state: "unknown", locked: true };
        });
        return Response.json({ ok: true, ...result });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "租约状态写入失败";
        return Response.json({ ok: false, error: reason }, { status: 409 });
      }
    }


    if (url.pathname === "/internal/finalize" && request.method === "POST") {
      let input: Record<string, unknown>;
      try {
        const rawBody = await request.text();
        if (new TextEncoder().encode(rawBody).byteLength > 512_000) {
          return Response.json({ error: "成交对账请求体过大" }, { status: 413 });
        }
        const parsed: unknown = JSON.parse(rawBody);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return Response.json({ error: "成交对账参数无效" }, { status: 400 });
        }
        input = parsed as Record<string, unknown>;
      } catch {
        return Response.json({ error: "成交对账JSON无效" }, { status: 400 });
      }

      const intentId = typeof input.intentId === "string" ? input.intentId : "";
      const attempt = input.attempt;
      const leaseToken = typeof input.leaseToken === "string" ? input.leaseToken : "";
      const exchangeOrderId = typeof input.exchangeOrderId === "string" ? input.exchangeOrderId : "";
      const exchangeStatus = input.exchangeStatus;
      const executedQty = typeof input.executedQty === "string" ? input.executedQty : "";
      const cumulativeQuoteQty = typeof input.cumulativeQuoteQty === "string" ? input.cumulativeQuoteQty : "";
      const exchangeTerminalAt = input.exchangeTerminalAt;
      const fills = input.fills;
      const terminalStatuses = ["FILLED", "CANCELED", "EXPIRED", "EXPIRED_IN_MATCH", "REJECTED"];
      if (!intentId || !Number.isSafeInteger(attempt) || (attempt as number) <= 0 ||
          !leaseToken || !/^[0-9]{1,32}$/.test(exchangeOrderId) ||
          !terminalStatuses.includes(String(exchangeStatus)) ||
          !Number.isSafeInteger(exchangeTerminalAt) || (exchangeTerminalAt as number) <= 0 ||
          (exchangeTerminalAt as number) > Date.now() + 5_000 ||
          compareDecimalStrings(executedQty, "0") === null ||
          compareDecimalStrings(cumulativeQuoteQty, "0") === null ||
          compareDecimalStrings(executedQty, "0")! < 0 ||
          compareDecimalStrings(cumulativeQuoteQty, "0")! < 0 ||
          !Array.isArray(fills) || fills.length > 1000) {
        return Response.json({ error: "交易所终态或累计成交字段无效" }, { status: 400 });
      }

      const normalizedFills: Array<{
        tradeId: string; orderId: string; qty: string; quoteQty: string;
        commission: string; commissionAsset: string; filledAt: number;
      }> = [];
      const seenTradeIds = new Set<string>();
      for (const value of fills) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return Response.json({ error: "成交明细格式无效" }, { status: 400 });
        }
        const fill = value as Record<string, unknown>;
        const tradeId = typeof fill.tradeId === "string" ? fill.tradeId : "";
        const orderId = typeof fill.orderId === "string" ? fill.orderId : "";
        const qty = typeof fill.qty === "string" ? fill.qty : "";
        const quoteQty = typeof fill.quoteQty === "string" ? fill.quoteQty : "";
        const commission = typeof fill.commission === "string" ? fill.commission : "";
        const commissionAsset = typeof fill.commissionAsset === "string" ? fill.commissionAsset : "";
        const filledAt = fill.filledAt;
        if (!/^[0-9]{1,32}$/.test(tradeId) || seenTradeIds.has(tradeId) ||
            orderId !== exchangeOrderId ||
            qty.length > 48 || quoteQty.length > 48 || commission.length > 48 ||
            compareDecimalStrings(qty, "0") === null || compareDecimalStrings(qty, "0")! <= 0 ||
            compareDecimalStrings(quoteQty, "0") === null || compareDecimalStrings(quoteQty, "0")! <= 0 ||
            compareDecimalStrings(commission, "0") === null || compareDecimalStrings(commission, "0")! < 0 ||
            !/^[A-Z0-9]{2,12}$/.test(commissionAsset) ||
            !Number.isSafeInteger(filledAt) || (filledAt as number) <= 0 ||
            (filledAt as number) > Date.now() + 5_000 ||
            (filledAt as number) > (exchangeTerminalAt as number)) {
          return Response.json({ error: "成交明细存在无效字段或重复tradeId" }, { status: 400 });
        }
        seenTradeIds.add(tradeId);
        normalizedFills.push({ tradeId, orderId, qty, quoteQty, commission, commissionAsset, filledAt: filledAt as number });
      }

      const summedQty = addDecimalStrings(normalizedFills.map((fill) => fill.qty));
      const summedQuoteQty = addDecimalStrings(normalizedFills.map((fill) => fill.quoteQty));
      if (summedQty === null || summedQuoteQty === null ||
          compareDecimalStrings(summedQty, executedQty) !== 0 ||
          compareDecimalStrings(summedQuoteQty, cumulativeQuoteQty) !== 0 ||
          ((compareDecimalStrings(executedQty, "0") === 0) !== (normalizedFills.length === 0)) ||
          (exchangeStatus === "FILLED" && compareDecimalStrings(executedQty, "0") === 0)) {
        return Response.json({ error: "逐笔成交数量/金额与交易所累计成交不一致，禁止释放资金" }, { status: 409 });
      }

      const now = Date.now();
      try {
        const finalized = this.state.storage.transactionSync(() => {
          const sql = this.state.storage.sql;
          const lockRows = sql.exec(
            "SELECT intent_id, attempt, lease_token, lease_until, asset, reserved_amount FROM account_lock WHERE singleton = 1",
          ).toArray();
          const lock = lockRows[0] as {
            intent_id?: string; attempt?: number; lease_token?: string; lease_until?: number;
            asset?: string; reserved_amount?: string;
          } | undefined;
          if (!lock || lock.intent_id !== intentId || lock.attempt !== attempt ||
              lock.lease_token !== leaseToken || !Number.isSafeInteger(lock.lease_until) ||
              (lock.lease_until as number) <= now) {
            throw new Error("账户锁或租约不匹配/已过期，拒绝终态释放");
          }

          const intentRows = sql.exec(
            "SELECT symbol, side, amount, state, attempt, client_order_id FROM order_intents WHERE intent_id = ?",
            intentId,
          ).toArray();
          const order = intentRows[0] as {
            symbol?: string; side?: string; amount?: string; state?: string;
            attempt?: number; client_order_id?: string;
          } | undefined;
          if (!order || order.attempt !== attempt || !order.symbol ||
              (order.state !== "reconciling" && order.state !== "unknown" && order.state !== "submitting")) {
            throw new Error("订单状态/attempt不允许终态核对");
          }

          const attemptRows = sql.exec(
            "SELECT client_order_id, lease_token FROM order_attempts WHERE intent_id = ? AND attempt = ?",
            intentId, attempt,
          ).toArray();
          const attemptRow = attemptRows[0] as { client_order_id?: string; lease_token?: string } | undefined;
          if (!attemptRow || attemptRow.client_order_id !== order.client_order_id ||
              attemptRow.lease_token !== leaseToken) {
            throw new Error("attempt记录与订单或当前租约不一致");
          }

          const reservationRows = sql.exec(
            "SELECT asset, amount, state FROM reservations WHERE intent_id = ? AND attempt = ?",
            intentId, attempt,
          ).toArray();
          const reservation = reservationRows[0] as { asset?: string; amount?: string; state?: string } | undefined;
          const expectedAsset = order.side === "BUY" ? "USDT" : order.symbol.slice(0, -4);
          if (!reservation || reservation.state !== "reserved" || reservation.asset !== expectedAsset ||
              lock.asset !== expectedAsset ||
              compareDecimalStrings(lock.reserved_amount ?? "", reservation.amount ?? "") !== 0 ||
              compareDecimalStrings(reservation.amount ?? "", order.amount ?? "") !== 0) {
            throw new Error("资金预留与订单方向/金额不一致");
          }

          let reservedAssetCommission = "0";
          for (const fill of normalizedFills) {
            if (fill.commissionAsset === expectedAsset) {
              const next = addDecimalStrings([reservedAssetCommission, fill.commission]);
              if (next === null) throw new Error("手续费累计失败");
              reservedAssetCommission = next;
            }
            const inserted = sql.exec(
              `INSERT INTO fills(
                symbol, trade_id, intent_id, attempt, order_id, qty,
                quote_qty, commission, commission_asset, filled_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(symbol, trade_id) DO NOTHING
              RETURNING trade_id`,
              order.symbol, fill.tradeId, intentId, attempt, exchangeOrderId,
              fill.qty, fill.quoteQty, fill.commission, fill.commissionAsset, fill.filledAt,
            ).toArray();
            if (inserted.length === 0) {
              const existingFillRows = sql.exec(
                "SELECT intent_id, attempt, order_id, qty, quote_qty, commission, commission_asset, filled_at FROM fills WHERE symbol = ? AND trade_id = ?",
                order.symbol, fill.tradeId,
              ).toArray();
              const existingFill = existingFillRows[0] as {
                intent_id?: string; attempt?: number; order_id?: string; qty?: string;
                quote_qty?: string; commission?: string; commission_asset?: string; filled_at?: number;
              } | undefined;
              if (!existingFill || existingFill.intent_id !== intentId ||
                  existingFill.attempt !== attempt || existingFill.order_id !== exchangeOrderId ||
                  existingFill.qty !== fill.qty || existingFill.quote_qty !== fill.quoteQty ||
                  existingFill.commission !== fill.commission ||
                  existingFill.commission_asset !== fill.commissionAsset ||
                  existingFill.filled_at !== fill.filledAt) {
                throw new Error("tradeId已存在但内容/订单归属不一致，拒绝覆盖");
              }
            }
          }

          const consumedBase = order.side === "SELL"
            ? addDecimalStrings([summedQty, reservedAssetCommission])
            : "0";
          const consumedQuote = order.side === "BUY"
            ? addDecimalStrings([summedQuoteQty, reservedAssetCommission])
            : "0";
          const consumedAmount = order.side === "BUY" ? consumedQuote : consumedBase;
          if (consumedAmount === null || compareDecimalStrings(consumedAmount, reservation.amount ?? "") === null ||
              compareDecimalStrings(consumedAmount, reservation.amount ?? "")! > 0) {
            throw new Error("实际消耗（含预留资产手续费）超过预留金额，转人工核对且不释放锁");
          }

          if (exchangeStatus === "FILLED" && order.side === "SELL" &&
              compareDecimalStrings(executedQty, order.amount ?? "") !== 0) {
            throw new Error("SELL订单交易所FILLED数量与原始委托数量不一致，拒绝释放");
          }

          const nextState = exchangeStatus === "FILLED"
            ? "filled"
            : compareDecimalStrings(executedQty, "0")! > 0
              ? "partial_terminal"
              : exchangeStatus === "CANCELED" ? "canceled"
                : exchangeStatus === "EXPIRED" || exchangeStatus === "EXPIRED_IN_MATCH" ? "expired" : "rejected";

          const fillRows = sql.exec(
            "SELECT COUNT(*) AS total FROM fills WHERE intent_id = ? AND attempt = ? AND order_id = ?",
            intentId, attempt, exchangeOrderId,
          ).toArray();
          const fillCount = fillRows[0] && typeof fillRows[0] === "object"
            ? Number((fillRows[0] as { total?: number }).total ?? 0) : -1;
          if (fillCount !== normalizedFills.length) {
            throw new Error("成交账本数量与本次终态快照不一致，拒绝释放资金");
          }

          const reservationUpdated = sql.exec(
            "UPDATE reservations SET consumed_amount = ?, state = 'settled', updated_at = ? WHERE intent_id = ? AND attempt = ? AND state = 'reserved' RETURNING reservation_id",
            consumedAmount, now, intentId, attempt,
          ).toArray();
          if (reservationUpdated.length !== 1) throw new Error("资金预留状态已变化，拒绝释放");
          const intentUpdated = sql.exec(
            "UPDATE order_intents SET state = ?, exchange_order_id = ?, exchange_terminal_at = ?, fills_reconciled_at = ?, updated_at = ?, last_error = NULL WHERE intent_id = ? AND attempt = ? AND state IN ('submitting', 'unknown', 'reconciling') RETURNING intent_id",
            nextState, exchangeOrderId, exchangeTerminalAt, Math.max(now, exchangeTerminalAt as number), now, intentId, attempt,
          ).toArray();
          if (intentUpdated.length !== 1) throw new Error("订单状态已变化，拒绝终态写入");
          const attemptUpdated = sql.exec(
            "UPDATE order_attempts SET state = ?, exchange_order_id = ?, updated_at = ? WHERE intent_id = ? AND attempt = ? AND lease_token = ? RETURNING attempt_id",
            nextState, exchangeOrderId, now, intentId, attempt, leaseToken,
          ).toArray();
          if (attemptUpdated.length !== 1) throw new Error("attempt租约已变化，拒绝终态写入");
          const lockDeleted = sql.exec(
            "DELETE FROM account_lock WHERE singleton = 1 AND intent_id = ? AND attempt = ? AND lease_token = ? RETURNING intent_id",
            intentId, attempt, leaseToken,
          ).toArray();
          if (lockDeleted.length !== 1) throw new Error("账户锁已变化，拒绝释放");
          sql.exec(
            "INSERT INTO audit_events(intent_id, event_type, created_at) VALUES (?, 'intent_terminal_reconciled_and_released', ?)",
            intentId, now,
          );
          return { intentId, attempt, exchangeOrderId, state: nextState, fillCount, consumedAmount, releasedReservation: true };
        });
        return Response.json({ ok: true, ...finalized });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "终态成交核对失败";
        return Response.json({ ok: false, error: reason }, { status: 409 });
      }
    }

    return Response.json({ error: "内部执行协调器路径不存在" }, { status: 404 });
  }

  async alarm(): Promise<void> {
    await this.ready;
    const now = Date.now();
    const sql = this.state.storage.sql;
    sql.exec(
      `INSERT INTO account_metadata(key, value, updated_at)
       VALUES ('last_alarm_at', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      String(now),
      now,
    );

    // Alarm只做持久化租约恢复和下一次唤醒安排，不在SQLite事务中执行网络请求，
    // 也不会把任务伪标记为完成。真正的只读任务执行器在后续任务中接入。
    this.state.storage.transactionSync(() => {
      const expiredRows = sql.exec(
        `SELECT task_id, attempt FROM scheduler_tasks
         WHERE state = 'leased' AND lease_until IS NOT NULL AND lease_until <= ?
         ORDER BY lease_until ASC LIMIT 100`,
        now,
      ).toArray();
      for (const value of expiredRows) {
        if (!value || typeof value !== "object") continue;
        const row = value as { task_id?: unknown; attempt?: unknown };
        if (typeof row.task_id !== "string" || !Number.isSafeInteger(row.attempt) ||
            (row.attempt as number) <= 0) continue;
        const decision = expiredSchedulerLeaseDecision(row.attempt as number, now);
        if (decision.state === "manual_review") {
          sql.exec(
            `UPDATE scheduler_tasks
             SET state = 'manual_review', lease_token = NULL, lease_until = NULL,
                 last_error = '租约过期且达到最大尝试次数', updated_at = ?
             WHERE task_id = ? AND state = 'leased' AND attempt = ? AND lease_until <= ?`,
            now, row.task_id, row.attempt, now,
          );
        } else {
          sql.exec(
            `UPDATE scheduler_tasks
             SET state = 'pending', lease_token = NULL, lease_until = NULL,
                 next_attempt_at = ?, last_error = '租约过期，等待退避后重试', updated_at = ?
             WHERE task_id = ? AND state = 'leased' AND attempt = ? AND lease_until <= ?`,
            decision.nextAttemptAt, now, row.task_id, row.attempt, now,
          );
        }
      }
    });

    const dueRows = sql.exec(
      `SELECT MIN(CASE
        WHEN state = 'pending' THEN MAX(due_at, next_attempt_at)
        WHEN state = 'leased' THEN lease_until
        ELSE NULL END) AS next_at
       FROM scheduler_tasks WHERE state IN ('pending', 'leased')`,
    ).toArray();
    const nextAt = dueRows[0] && typeof dueRows[0] === "object"
      ? (dueRows[0] as { next_at?: unknown }).next_at
      : null;
    if (typeof nextAt === "number" && Number.isSafeInteger(nextAt) && nextAt > 0) {
      // 到期pending任务目前尚未接入执行器；避免每秒唤醒形成空转。
      // Cron每分钟提供兜底唤醒，执行器接通后再缩短到精确dueAt。
      await this.state.storage.setAlarm(Math.max(now + 60_000, nextAt));
    } else if (this.state.storage.deleteAlarm) {
      await this.state.storage.deleteAlarm();
    }
  }
}
