import { randomUUID } from "node:crypto";
import type { ExecutionFill, TradeLedgerEntry } from "../types";
import type { SellEventRecord } from "../sell-store.browser";
import {
  validateServerExecutionIntent,
  type ExecutionLease,
  type ServerExecutionIntent,
} from "../server-execution-core";
import {
  expiredSchedulerLeaseDecision,
  schedulerTaskRetryAt,
  SCHEDULER_TASK_MAX_ATTEMPTS,
  validateSchedulerTaskInput,
} from "../scheduler-task-core";
import { buildTradeFillNotificationEvent } from "../notification-outbox";
import type {
  CreateIntentResult,
  ExecutionLeaseInput,
  FinalizeReconciledOrderInput,
  IntentClaimInput,
  IntentClaimResult,
  LocalExecutionStore,
  MarkSubmittingInput,
  MarkUnknownInput,
  ReconcileContext,
  SchedulerTaskInput,
  SchedulerTaskLease,
} from "./store";
import { LocalExecutionDatabase, openLocalExecutionDatabase, type LocalExecutionDatabaseOptions } from "./sqlite-database";

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SQLite返回了无效记录");
  }
  return value as Row;
}

function parseIntent(rowValue: unknown): ServerExecutionIntent {
  const row = asRow(rowValue);
  return {
    intentId: String(row.intent_id),
    strategyEventId: String(row.strategy_event_id),
    strategyVersion: "3.3",
    symbol: String(row.symbol),
    side: row.side === "SELL" ? "SELL" : "BUY",
    quoteAsset: "USDT",
    amount: String(row.amount),
    baseRatioAtSignal: row.base_ratio_at_signal == null ? undefined : Number(row.base_ratio_at_signal),
    state: String(row.state) as ServerExecutionIntent["state"],
    attempt: Number(row.attempt),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    exchangeOrderId: row.exchange_order_id == null ? null : String(row.exchange_order_id),
    clientOrderId: row.client_order_id == null ? null : String(row.client_order_id),
    exchangeTerminalAt: row.exchange_terminal_at == null ? null : Number(row.exchange_terminal_at),
    fillsReconciledAt: row.fills_reconciled_at == null ? null : Number(row.fills_reconciled_at),
    lastError: row.last_error == null ? null : String(row.last_error),
  };
}

function parseSellEvent(rowValue: unknown): SellEventRecord {
  const row = asRow(rowValue);
  let fillIds: string[];
  try {
    const parsed: unknown = JSON.parse(String(row.fill_ids_json ?? "[]"));
    if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
      throw new Error("成交ID列表格式无效");
    }
    fillIds = parsed;
  } catch {
    throw new Error("SQLite卖出事件成交ID数据损坏，必须人工复核");
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
    fillIds,
    lastError: row.last_error == null ? null : String(row.last_error),
    exchangeTerminalStatus: row.exchange_terminal_status == null ? undefined : String(row.exchange_terminal_status),
    fillReconcileCompletedAt: row.fill_reconcile_completed_at == null ? undefined : Number(row.fill_reconcile_completed_at),
    lotStepSize: row.lot_step_size == null ? undefined : Number(row.lot_step_size),
  };
}

function parseTradeLedger(rowValue: unknown): TradeLedgerEntry {
  const row = asRow(rowValue);
  return {
    id: String(row.id),
    fillId: String(row.fill_id),
    orderId: String(row.order_id),
    symbol: String(row.symbol),
    side: row.side === "SELL" ? "SELL" : "BUY",
    time: Number(row.time),
    price: Number(row.price),
    qty: Number(row.qty),
    quoteQty: Number(row.quote_qty),
    commission: Number(row.commission),
    commissionAsset: String(row.commission_asset),
    commissionUsdt: Number(row.commission_usdt),
    realizedPnlUsdt: row.realized_pnl_usdt == null ? null : Number(row.realized_pnl_usdt),
    sellKind: row.sell_kind == null ? undefined : String(row.sell_kind) as NonNullable<TradeLedgerEntry["sellKind"]>,
    baseRatioAtBuy: row.base_ratio_at_buy == null ? undefined : Number(row.base_ratio_at_buy),
  };
}

function parseSchedulerLease(rowValue: unknown): SchedulerTaskLease {
  const row = asRow(rowValue);
  return {
    taskId: String(row.task_id),
    taskType: String(row.task_type) as SchedulerTaskLease["taskType"],
    dueAt: Number(row.due_at),
    attempt: Number(row.attempt),
    leaseToken: String(row.lease_token),
    leaseUntil: Number(row.lease_until),
  };
}

interface DecimalValue {
  units: bigint;
  scale: number;
}

function decimal(value: string): DecimalValue {
  if (typeof value !== "string" || value.length > 48 ||
      !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) {
    throw new Error("成交或预留金额不是有效的十进制字符串");
  }
  const [whole, fraction = ""] = value.split(".");
  return { units: BigInt(whole + fraction), scale: fraction.length };
}

function compareDecimal(left: string, right: string): number {
  const a = decimal(left);
  const b = decimal(right);
  const scale = Math.max(a.scale, b.scale);
  const x = a.units * 10n ** BigInt(scale - a.scale);
  const y = b.units * 10n ** BigInt(scale - b.scale);
  return x < y ? -1 : x > y ? 1 : 0;
}

function sumDecimals(values: string[]): string {
  const parsed = values.map(decimal);
  const scale = Math.max(0, ...parsed.map((item) => item.scale));
  const total = parsed.reduce(
    (sum, item) => sum + item.units * 10n ** BigInt(scale - item.scale),
    0n,
  );
  const factor = 10n ** BigInt(scale);
  const whole = total / factor;
  const fraction = scale
    ? (total % factor).toString().padStart(scale, "0").replace(/0+$/, "")
    : "";
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function validTime(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function changes(value: unknown): number {
  if (!value || typeof value !== "object" || !("changes" in value)) return 0;
  return Number((value as { changes?: number | bigint }).changes ?? 0);
}

function mapSellKind(strategyEventId: string): NonNullable<TradeLedgerEntry["sellKind"]> {
  const raw = strategyEventId.split(":")[1] ?? "";
  const map: Record<string, NonNullable<TradeLedgerEntry["sellKind"]>> = {
    takeProfit: "take_profit",
    indicatorProfit: "indicator_profit",
    trailStop: "trail_stop",
    baseReduce: "base_reduce",
    take_profit: "take_profit",
    indicator_profit: "indicator_profit",
    trail_stop: "trail_stop",
    base_reduce: "base_reduce",
  };
  const kind = map[raw];
  if (!kind) throw new Error("SELL策略事件缺少可识别的卖出类型，拒绝写入持仓台账");
  return kind;
}

function sameFill(existing: TradeLedgerEntry, incoming: ExecutionFill, sellKind: string | null): boolean {
  return existing.fillId === incoming.fillId &&
    existing.orderId === incoming.orderId &&
    existing.symbol === incoming.symbol &&
    existing.side === incoming.side &&
    existing.time === incoming.time &&
    existing.price === incoming.price &&
    existing.qty === incoming.qty &&
    existing.quoteQty === incoming.quoteQty &&
    existing.commission === incoming.commission &&
    existing.commissionAsset === incoming.commissionAsset &&
    existing.commissionUsdt === incoming.commissionUsdt &&
    (existing.sellKind ?? null) === sellKind;
}

export class SqliteExecutionStore implements LocalExecutionStore {
  readonly scheduler: LocalExecutionStore["scheduler"];
  readonly sellEvents: LocalExecutionStore["sellEvents"];
  readonly tradeLedger: LocalExecutionStore["tradeLedger"];
  private readonly database: LocalExecutionDatabase;

  private constructor(database: LocalExecutionDatabase) {
    this.database = database;
    this.scheduler = {
      enqueue: (input, now) => this.enqueueTask(input, now),
      claimDue: (input) => this.claimDueTasks(input),
      renew: (lease, now, leaseMs) => this.renewTaskLease(lease, now, leaseMs),
      ack: (lease, now) => this.ackTask(lease, now),
      retry: (lease, now, reason) => this.retryTask(lease, now, reason),
      recoverExpired: (now) => this.recoverExpiredTasks(now),
    };
    this.sellEvents = {
      reserveSellEvent: (record) => this.reserveSellEvent(record),
      updateSellEvent: (record) => this.updateSellEvent(record),
      listSellEvents: () => this.listSellEvents(),
      claimSellEventForSubmission: (eventKey, clientOrderId, now) =>
        this.claimSellEventForSubmission(eventKey, clientOrderId, now),
      bindSellEventToExchangeOrder: (eventKey, exchangeOrderId, now) =>
        this.bindSellEventToExchangeOrder(eventKey, exchangeOrderId, now),
    };
    this.tradeLedger = {
      listTradeLedger: () => this.listTradeLedger(),
      recordConfirmedSellFill: (fill, sellKind) => this.recordConfirmedSellFill(fill, sellKind),
    };
  }

  static async open(options: LocalExecutionDatabaseOptions = {}): Promise<SqliteExecutionStore> {
    return new SqliteExecutionStore(await openLocalExecutionDatabase(options));
  }

  private get<T extends Row>(sql: string, ...params: Array<string | number | bigint | null>): T | undefined {
    return this.database.prepare(sql).get(...params) as T | undefined;
  }

  private all<T extends Row>(sql: string, ...params: Array<string | number | bigint | null>): T[] {
    return this.database.prepare(sql).all(...params) as T[];
  }

  private run(sql: string, ...params: Array<string | number | bigint | null>): number {
    return changes(this.database.prepare(sql).run(...params));
  }

  private transaction<T>(work: () => T): T {
    return this.database.transaction(work);
  }

  async createIntent(intent: ServerExecutionIntent): Promise<CreateIntentResult> {
    const invalid = validateServerExecutionIntent(intent);
    if (invalid) throw new Error(invalid);
    if (intent.state !== "queued" || intent.attempt !== 0 || intent.clientOrderId !== null ||
        intent.exchangeOrderId !== null) {
      throw new Error("新建订单意图必须从queued/attempt=0开始");
    }
    return this.transaction(() => {
      const inserted = this.run(
        `INSERT INTO order_intents(
          intent_id, strategy_event_id, strategy_version, symbol, side, quote_asset,
          amount, base_ratio_at_signal, state, attempt, created_at, updated_at, exchange_order_id,
          client_order_id, exchange_terminal_at, fills_reconciled_at, last_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING`,
        intent.intentId, intent.strategyEventId, intent.strategyVersion, intent.symbol,
        intent.side, intent.quoteAsset, intent.amount, intent.baseRatioAtSignal ?? null,
        intent.state, intent.attempt, intent.createdAt, intent.updatedAt, intent.exchangeOrderId, intent.clientOrderId,
        intent.exchangeTerminalAt, intent.fillsReconciledAt, intent.lastError,
      );
      const existing = this.get(
        "SELECT * FROM order_intents WHERE intent_id = ? OR strategy_event_id = ?",
        intent.intentId, intent.strategyEventId,
      );
      if (!existing || existing.intent_id !== intent.intentId ||
          existing.strategy_event_id !== intent.strategyEventId) {
        throw new Error("策略事件或intentId幂等冲突，拒绝覆盖已有订单");
      }
      if (inserted) {
        this.run(
          "INSERT INTO audit_events(intent_id, event_type, created_at) VALUES (?, 'intent_created', ?)",
          intent.intentId, intent.updatedAt,
        );
      }
      return { intent: parseIntent(existing), created: inserted === 1 };
    });
  }

  async getIntent(intentId: string): Promise<ServerExecutionIntent | null> {
    const row = this.get("SELECT * FROM order_intents WHERE intent_id = ?", intentId);
    return row ? parseIntent(row) : null;
  }

  async listRunnableIntents(now: number, limit: number): Promise<ServerExecutionIntent[]> {
    if (!validTime(now) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("待执行订单列表参数无效");
    }
    return this.all(
      "SELECT * FROM order_intents WHERE state = 'queued' ORDER BY created_at ASC LIMIT ?",
      limit,
    ).map(parseIntent);
  }

  async claimIntent(input: IntentClaimInput): Promise<IntentClaimResult | null> {
    const { intentId, availableAsset, availableAmount, snapshotAt, now, leaseMs } = input;
    if (!intentId || !/^[A-Z0-9]{2,12}$/.test(availableAsset) ||
        !validTime(snapshotAt) || !validTime(now) || snapshotAt > now + 5_000 ||
        now - snapshotAt > 60_000 || !Number.isSafeInteger(leaseMs) ||
        leaseMs < 5_000 || leaseMs > 120_000 || compareDecimal(availableAmount, "0") <= 0) {
      throw new Error("账户余额快照或订单领取参数无效/已过期");
    }
    return this.transaction(() => {
      const row = this.get("SELECT * FROM order_intents WHERE intent_id = ?", intentId);
      if (!row || row.state !== "queued") return null;
      const intent = parseIntent(row);
      if (intent.side === "BUY" && (!Number.isFinite(intent.baseRatioAtSignal) ||
          (intent.baseRatioAtSignal as number) < 0 || (intent.baseRatioAtSignal as number) > 1)) {
        throw new Error("BUY意图缺少有效的历史底仓比例，拒绝领取");
      }
      const expectedAsset = intent.side === "BUY" ? "USDT" : intent.symbol.slice(0, -4);
      if (!intent.symbol.endsWith("USDT") || availableAsset !== expectedAsset) {
        throw new Error("余额资产与订单方向/交易对不匹配");
      }
      if (compareDecimal(availableAmount, intent.amount) < 0) {
        throw new Error("账户可用余额不足，未创建资金预留");
      }
      if (this.get("SELECT intent_id FROM account_lock WHERE singleton = 1")) return null;
      // 账户锁或预留表若出现不一致，不能因为锁缺失就继续下一笔交易。
      const unresolved = this.get(
        `SELECT intent_id FROM order_intents
         WHERE state IN ('reserved', 'submitting', 'unknown', 'reconciling', 'partial_open', 'manual_review')
         LIMIT 1`,
      );
      const orphanReservation = this.get(
        "SELECT reservation_id FROM reservations WHERE state IN ('reserved', 'manual_review') LIMIT 1",
      );
      if (unresolved || orphanReservation) return null;

      const attempt = intent.attempt + 1;
      if (!Number.isSafeInteger(attempt) || attempt <= 0) throw new Error("订单attempt计数无效");
      const leaseToken = randomUUID();
      const clientOrderId = `gpt${randomUUID().replaceAll("-", "").slice(0, 32)}`;
      const leaseUntil = now + leaseMs;
      const reservationId = `${intentId}:${attempt}:${availableAsset}`;
      const updated = this.run(
        "UPDATE order_intents SET state = 'reserved', attempt = ?, client_order_id = ?, updated_at = ? WHERE intent_id = ? AND state = 'queued'",
        attempt, clientOrderId, now, intentId,
      );
      if (updated !== 1) throw new Error("订单状态已变化，领取失败");
      this.run(
        `INSERT INTO reservations(
          reservation_id, intent_id, asset, amount, consumed_amount, attempt, state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, '0', ?, 'reserved', ?, ?)`,
        reservationId, intentId, availableAsset, intent.amount, attempt, now, now,
      );
      this.run(
        `INSERT INTO order_attempts(
          attempt_id, intent_id, attempt, client_order_id, lease_token, lease_until, state, started_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?)`,
        `${intentId}:${attempt}`, intentId, attempt, clientOrderId, leaseToken, leaseUntil, now, now,
      );
      this.run(
        `INSERT INTO account_lock(
          singleton, intent_id, attempt, lease_token, lease_until, asset, reserved_amount, created_at, updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        intentId, attempt, leaseToken, leaseUntil, availableAsset, intent.amount, now, now,
      );
      this.run(
        "INSERT INTO audit_events(intent_id, event_type, created_at) VALUES (?, 'intent_claimed_and_reserved', ?)",
        intentId, now,
      );
      const claimed = this.get("SELECT * FROM order_intents WHERE intent_id = ?", intentId);
      if (!claimed) throw new Error("订单领取后无法读取订单");
      return {
        intent: parseIntent(claimed),
        lease: { intentId, attempt, token: leaseToken, leaseUntil },
        reservationId,
        reservedAsset: availableAsset,
        reservedAmount: intent.amount,
      };
    });
  }

  async renewExecutionLease(lease: ExecutionLeaseInput, leaseMs: number): Promise<boolean> {
    if (!validTime(lease.now) || !Number.isSafeInteger(leaseMs) || leaseMs < 5_000 || leaseMs > 120_000) {
      throw new Error("账户租约续期参数无效");
    }
    return this.transaction(() => {
      const lock = this.get(
        "SELECT lease_until FROM account_lock WHERE singleton = 1 AND intent_id = ? AND attempt = ? AND lease_token = ?",
        lease.intentId, lease.attempt, lease.leaseToken,
      );
      if (!lock || Number(lock.lease_until) <= lease.now) return false;
      const until = lease.now + leaseMs;
      if (this.run(
        "UPDATE account_lock SET lease_until = ?, updated_at = ? WHERE singleton = 1 AND intent_id = ? AND attempt = ? AND lease_token = ? AND lease_until > ?",
        until, lease.now, lease.intentId, lease.attempt, lease.leaseToken, lease.now,
      ) !== 1) return false;
      if (this.run(
        "UPDATE order_attempts SET lease_until = ?, updated_at = ? WHERE intent_id = ? AND attempt = ? AND lease_token = ?",
        until, lease.now, lease.intentId, lease.attempt, lease.leaseToken,
      ) !== 1) throw new Error("订单attempt租约记录缺失，拒绝只更新账户锁");
      this.run(
        "INSERT INTO audit_events(intent_id, event_type, created_at) VALUES (?, 'execution_lease_renewed', ?)",
        lease.intentId, lease.now,
      );
      return true;
    });
  }

  async markSubmitting(input: MarkSubmittingInput): Promise<ServerExecutionIntent> {
    if (!/^[A-Za-z0-9_-]{1,36}$/.test(input.clientOrderId) || !validTime(input.now)) {
      throw new Error("提交前订单标识或时间无效");
    }
    return this.transaction(() => {
      const lock = this.get(
        "SELECT lease_until FROM account_lock WHERE singleton = 1 AND intent_id = ? AND attempt = ? AND lease_token = ?",
        input.intentId, input.attempt, input.leaseToken,
      );
      const row = this.get("SELECT * FROM order_intents WHERE intent_id = ?", input.intentId);
      if (!lock || Number(lock.lease_until) <= input.now || !row ||
          row.state !== "reserved" || Number(row.attempt) !== input.attempt ||
          row.client_order_id !== input.clientOrderId) {
        throw new Error("账户租约、attempt或订单状态不匹配，拒绝进入submitting");
      }
      if (this.run(
        "UPDATE order_intents SET state = 'submitting', updated_at = ? WHERE intent_id = ? AND attempt = ? AND state = 'reserved'",
        input.now, input.intentId, input.attempt,
      ) !== 1) throw new Error("订单状态已变化，拒绝进入submitting");
      if (this.run(
        "UPDATE order_attempts SET state = 'submitting', updated_at = ? WHERE intent_id = ? AND attempt = ? AND lease_token = ?",
        input.now, input.intentId, input.attempt, input.leaseToken,
      ) !== 1) throw new Error("订单attempt租约不匹配，拒绝进入submitting");
      this.run(
        `INSERT INTO scheduler_tasks(
          task_id, task_type, due_at, state, attempt, next_attempt_at, created_at, updated_at
        ) VALUES (?, 'reconcile_intent', ?, 'pending', 0, 0, ?, ?)
        ON CONFLICT(task_id) DO NOTHING`,
        `reconcile:${input.intentId}`, input.now + 5_000, input.now, input.now,
      );
      const reconcileTask = this.get("SELECT task_type FROM scheduler_tasks WHERE task_id = ?", `reconcile:${input.intentId}`);
      if (reconcileTask?.task_type !== "reconcile_intent") throw new Error("对账任务ID已被其他任务类型占用");
      this.run(
        "INSERT INTO audit_events(intent_id, event_type, created_at) VALUES (?, 'intent_marked_submitting', ?)",
        input.intentId, input.now,
      );
      const updated = this.get("SELECT * FROM order_intents WHERE intent_id = ?", input.intentId);
      if (!updated) throw new Error("submitting状态写入后无法读取订单");
      return parseIntent(updated);
    });
  }

  async markUnknown(input: MarkUnknownInput): Promise<ServerExecutionIntent> {
    if (!validTime(input.now) || !input.reason) throw new Error("unknown状态写入参数无效");
    return this.transaction(() => {
      const lock = this.get(
        "SELECT lease_until FROM account_lock WHERE singleton = 1 AND intent_id = ? AND attempt = ? AND lease_token = ?",
        input.intentId, input.attempt, input.leaseToken,
      );
      const row = this.get("SELECT state FROM order_intents WHERE intent_id = ? AND attempt = ?", input.intentId, input.attempt);
      if (!lock || Number(lock.lease_until) <= input.now || !row ||
          !["submitting", "reconciling"].includes(String(row.state))) {
        throw new Error("当前订单/租约不允许标记unknown");
      }
      if (this.run(
        "UPDATE order_intents SET state = 'unknown', last_error = ?, updated_at = ? WHERE intent_id = ? AND attempt = ? AND state IN ('submitting', 'reconciling')",
        input.reason.slice(0, 500), input.now, input.intentId, input.attempt,
      ) !== 1) throw new Error("订单状态已变化，拒绝标记unknown");
      if (this.run(
        "UPDATE order_attempts SET state = 'unknown', updated_at = ? WHERE intent_id = ? AND attempt = ? AND lease_token = ?",
        input.now, input.intentId, input.attempt, input.leaseToken,
      ) !== 1) throw new Error("订单attempt租约不匹配，拒绝标记unknown");
      this.run(
        `INSERT INTO scheduler_tasks(
          task_id, task_type, due_at, state, attempt, next_attempt_at, created_at, updated_at
        ) VALUES (?, 'reconcile_intent', ?, 'pending', 0, 0, ?, ?)
        ON CONFLICT(task_id) DO NOTHING`,
        `reconcile:${input.intentId}`, input.now + 1_000, input.now, input.now,
      );
      const reconcileTask = this.get("SELECT task_type FROM scheduler_tasks WHERE task_id = ?", `reconcile:${input.intentId}`);
      if (reconcileTask?.task_type !== "reconcile_intent") throw new Error("对账任务ID已被其他任务类型占用");
      this.run(
        "INSERT INTO audit_events(intent_id, event_type, created_at) VALUES (?, 'intent_marked_unknown', ?)",
        input.intentId, input.now,
      );
      const updated = this.get("SELECT * FROM order_intents WHERE intent_id = ?", input.intentId);
      if (!updated) throw new Error("unknown状态写入后无法读取订单");
      return parseIntent(updated);
    });
  }

  async takeoverForReconciliation(
    lease: ExecutionLeaseInput,
    leaseMs: number,
  ): Promise<ExecutionLease | null> {
    if (!validTime(lease.now) || !Number.isSafeInteger(leaseMs) || leaseMs < 5_000 || leaseMs > 120_000) {
      throw new Error("对账接管租约参数无效");
    }
    return this.transaction(() => {
      const lock = this.get(
        "SELECT lease_until FROM account_lock WHERE singleton = 1 AND intent_id = ? AND attempt = ? AND lease_token = ?",
        lease.intentId, lease.attempt, lease.leaseToken,
      );
      const order = this.get(
        "SELECT state, client_order_id FROM order_intents WHERE intent_id = ? AND attempt = ?",
        lease.intentId, lease.attempt,
      );
      if (!lock || Number(lock.lease_until) > lease.now || !order ||
          !order.client_order_id || !["submitting", "unknown", "reconciling"].includes(String(order.state))) {
        return null;
      }
      const nextToken = randomUUID();
      const nextUntil = lease.now + leaseMs;
      if (this.run(
        "UPDATE account_lock SET lease_token = ?, lease_until = ?, updated_at = ? WHERE singleton = 1 AND intent_id = ? AND attempt = ? AND lease_token = ? AND lease_until <= ?",
        nextToken, nextUntil, lease.now, lease.intentId, lease.attempt, lease.leaseToken, lease.now,
      ) !== 1) return null;
      if (this.run(
        "UPDATE order_attempts SET lease_token = ?, lease_until = ?, state = 'reconciling', updated_at = ? WHERE intent_id = ? AND attempt = ? AND lease_token = ?",
        nextToken, nextUntil, lease.now, lease.intentId, lease.attempt, lease.leaseToken,
      ) !== 1) throw new Error("订单attempt租约变化，拒绝接管");
      this.run(
        "UPDATE order_intents SET state = 'reconciling', updated_at = ? WHERE intent_id = ? AND attempt = ?",
        lease.now, lease.intentId, lease.attempt,
      );
      this.run(
        "INSERT INTO audit_events(intent_id, event_type, created_at) VALUES (?, 'lease_taken_over_reconcile_only', ?)",
        lease.intentId, lease.now,
      );
      return { intentId: lease.intentId, attempt: lease.attempt, token: nextToken, leaseUntil: nextUntil };
    });
  }

  async getReconcileContext(intentId: string): Promise<ReconcileContext | null> {
    const row = this.get("SELECT * FROM order_intents WHERE intent_id = ?", intentId);
    if (!row) return null;
    const lock = this.get(
      "SELECT attempt, lease_token, lease_until FROM account_lock WHERE singleton = 1 AND intent_id = ?",
      intentId,
    );
    const reservation = lock
      ? this.get("SELECT asset, amount FROM reservations WHERE intent_id = ? AND attempt = ?", intentId, Number(lock.attempt))
      : undefined;
    const intent = parseIntent(row);
    return {
      intent,
      lease: lock ? {
        intentId,
        attempt: Number(lock.attempt),
        token: String(lock.lease_token),
        leaseUntil: Number(lock.lease_until),
      } : null,
      reservedAsset: reservation ? String(reservation.asset) : null,
      reservedAmount: reservation ? String(reservation.amount) : null,
    };
  }

  async finalizeReconciledOrder(input: FinalizeReconciledOrderInput): Promise<ServerExecutionIntent> {
    const now = input.now;
    if (!validTime(now) || !/^[0-9]{1,32}$/.test(input.exchangeOrderId) ||
        !["FILLED", "CANCELED", "EXPIRED", "EXPIRED_IN_MATCH", "REJECTED"].includes(input.exchangeStatus) ||
        !validTime(input.exchangeTerminalAt) || input.exchangeTerminalAt > now + 5_000 ||
        input.fills.length > 1000) {
      throw new Error("交易所终态订单字段无效");
    }
    decimal(input.executedQty);
    decimal(input.cumulativeQuoteQty);
    if (compareDecimal(input.executedQty, "0") < 0 || compareDecimal(input.cumulativeQuoteQty, "0") < 0) {
      throw new Error("交易所累计成交数量/金额不能为负数");
    }
    const seen = new Set<string>();
    for (const fill of input.fills) {
      if (!/^[0-9]{1,32}$/.test(fill.tradeId) || seen.has(fill.tradeId) ||
          fill.orderId !== input.exchangeOrderId ||
          !/^[A-Z0-9]{2,12}$/.test(fill.commissionAsset) ||
          !validTime(fill.filledAt) || fill.filledAt > input.exchangeTerminalAt) {
        throw new Error("成交明细存在无效字段或重复tradeId");
      }
      if (compareDecimal(fill.qty, "0") <= 0 || compareDecimal(fill.quoteQty, "0") <= 0 ||
          compareDecimal(fill.commission, "0") < 0) {
        throw new Error("成交数量/金额必须为正数且手续费不能为负数");
      }
      if (compareDecimal(fill.price, "0") <= 0) throw new Error("成交价格必须为正数");
      seen.add(fill.tradeId);
    }
    const sumQty = sumDecimals(input.fills.map((fill) => fill.qty));
    const sumQuote = sumDecimals(input.fills.map((fill) => fill.quoteQty));
    if (compareDecimal(sumQty, input.executedQty) !== 0 ||
        compareDecimal(sumQuote, input.cumulativeQuoteQty) !== 0 ||
        ((compareDecimal(input.executedQty, "0") === 0) !== (input.fills.length === 0)) ||
        (input.exchangeStatus === "FILLED" && compareDecimal(input.executedQty, "0") === 0)) {
      throw new Error("逐笔成交数量/金额与交易所累计值不一致，拒绝结算");
    }

    return this.transaction(() => {
      const lock = this.get(
        "SELECT * FROM account_lock WHERE singleton = 1 AND intent_id = ? AND attempt = ? AND lease_token = ?",
        input.intentId, input.attempt, input.leaseToken,
      );
      if (!lock || Number(lock.lease_until) <= now) throw new Error("账户锁或租约不匹配/已过期，拒绝终态结算");
      if (input.schedulerLease) {
        const scheduler = this.get(
          "SELECT * FROM scheduler_tasks WHERE task_id = ?",
          input.schedulerLease.taskId,
        );
        if (input.schedulerLease.taskType !== "reconcile_intent" ||
            input.schedulerLease.taskId !== `reconcile:${input.intentId}` ||
            !scheduler || scheduler.state !== "leased" ||
            Number(scheduler.attempt) !== input.schedulerLease.attempt ||
            scheduler.lease_token !== input.schedulerLease.leaseToken ||
            Number(scheduler.lease_until) <= now) {
          throw new Error("调度任务租约已过期或fencing token不匹配，拒绝终态结算");
        }
      }
      const intentRow = this.get(
        "SELECT * FROM order_intents WHERE intent_id = ? AND attempt = ?",
        input.intentId, input.attempt,
      );
      if (!intentRow || !["submitting", "unknown", "reconciling"].includes(String(intentRow.state)) ||
          !intentRow.symbol || !intentRow.side || !intentRow.amount || !intentRow.client_order_id) {
        throw new Error("订单状态/attempt不允许终态核对");
      }
      const intent = parseIntent(intentRow);
      const attemptRow = this.get(
        "SELECT * FROM order_attempts WHERE intent_id = ? AND attempt = ?",
        input.intentId, input.attempt,
      );
      if (!attemptRow || attemptRow.client_order_id !== intent.clientOrderId ||
          attemptRow.lease_token !== input.leaseToken) {
        throw new Error("attempt记录与订单或当前租约不一致");
      }
      const reservation = this.get(
        "SELECT * FROM reservations WHERE intent_id = ? AND attempt = ?",
        input.intentId, input.attempt,
      );
      const expectedAsset = intent.side === "BUY" ? "USDT" : intent.symbol.slice(0, -4);
      if (!reservation || reservation.state !== "reserved" ||
          reservation.asset !== expectedAsset || lock.asset !== expectedAsset ||
          compareDecimal(String(lock.reserved_amount), String(reservation.amount)) !== 0 ||
          compareDecimal(String(reservation.amount), intent.amount) !== 0) {
        throw new Error("资金预留与订单方向/金额不一致");
      }

      let quoteCommission = "0";
      let baseCommission = "0";
      const sellKind = intent.side === "SELL" ? mapSellKind(intent.strategyEventId) : null;
      const baseAsset = intent.symbol.slice(0, -4);
      for (const fill of input.fills) {
        if (fill.commissionAsset === "USDT") quoteCommission = sumDecimals([quoteCommission, fill.commission]);
        else if (fill.commissionAsset === baseAsset) baseCommission = sumDecimals([baseCommission, fill.commission]);
        else if (compareDecimal(fill.commission, "0") > 0) {
          throw new Error(`手续费资产 ${fill.commissionAsset} 无法可靠换算，拒绝自动结算`);
        }

        const commissionUsdt = fill.commissionAsset === "USDT" ? fill.commission : "0";
        const fillInsert = this.run(
          `INSERT INTO fills(
            symbol, trade_id, intent_id, attempt, order_id, side, price, qty,
            quote_qty, commission, commission_asset, commission_usdt, filled_at, sell_kind
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(symbol, trade_id) DO NOTHING`,
          intent.symbol, fill.tradeId, input.intentId, input.attempt, input.exchangeOrderId,
          intent.side, fill.price, fill.qty, fill.quoteQty, fill.commission,
          fill.commissionAsset, commissionUsdt, fill.filledAt, sellKind,
        );
        if (fillInsert === 0) {
          const existing = this.get(
            "SELECT * FROM fills WHERE symbol = ? AND trade_id = ?",
            intent.symbol, fill.tradeId,
          );
          if (!existing || existing.intent_id !== input.intentId ||
              Number(existing.attempt) !== input.attempt || existing.order_id !== input.exchangeOrderId ||
              existing.side !== intent.side || existing.price !== fill.price || existing.qty !== fill.qty ||
              existing.quote_qty !== fill.quoteQty || existing.commission !== fill.commission ||
              existing.commission_asset !== fill.commissionAsset ||
              existing.commission_usdt !== commissionUsdt ||
              Number(existing.filled_at) !== fill.filledAt ||
              (existing.sell_kind ?? null) !== sellKind) {
            throw new Error("tradeId已存在但成交内容或订单归属不一致，拒绝覆盖");
          }
        }

        const numericFill: ExecutionFill = {
          fillId: fill.tradeId,
          orderId: fill.orderId,
          symbol: intent.symbol,
          side: intent.side,
          time: fill.filledAt,
          price: Number(fill.price),
          qty: Number(fill.qty),
          quoteQty: Number(fill.quoteQty),
          commission: Number(fill.commission),
          commissionAsset: fill.commissionAsset,
          commissionUsdt: Number(commissionUsdt),
        };
        if (![numericFill.price, numericFill.qty, numericFill.quoteQty, numericFill.commission, numericFill.commissionUsdt].every(Number.isFinite)) {
          throw new Error("成交数字超出本地台账可表示范围");
        }
        const baseRatioAtBuy = intent.side === "BUY" ? intent.baseRatioAtSignal ?? null : null;
        if (intent.side === "BUY" && (!Number.isFinite(baseRatioAtBuy) || baseRatioAtBuy! < 0 || baseRatioAtBuy! > 1)) {
          throw new Error("BUY订单缺少信号时冻结的底仓比例，拒绝写入持仓台账");
        }
        const ledger: TradeLedgerEntry = {
          ...numericFill,
          id: `${intent.symbol}:${fill.tradeId}`,
          realizedPnlUsdt: null,
          ...(sellKind ? { sellKind } : {}),
          ...(baseRatioAtBuy !== null ? { baseRatioAtBuy } : {}),
        };
        this.run(
          `INSERT INTO trade_ledger(
            id, symbol, fill_id, order_id, side, time, price, qty, quote_qty,
            commission, commission_asset, commission_usdt, realized_pnl_usdt,
            sell_kind, base_ratio_at_buy
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
          ON CONFLICT(symbol, fill_id) DO NOTHING`,
          ledger.id, ledger.symbol, ledger.fillId, ledger.orderId, ledger.side,
          ledger.time, ledger.price, ledger.qty, ledger.quoteQty, ledger.commission,
          ledger.commissionAsset, ledger.commissionUsdt, ledger.sellKind ?? null,
          ledger.baseRatioAtBuy ?? null,
        );
        const storedLedgerRow = this.get(
          "SELECT * FROM trade_ledger WHERE symbol = ? AND fill_id = ?",
          ledger.symbol, ledger.fillId,
        );
        if (!storedLedgerRow) throw new Error("成交台账写入后无法读取");
        const storedLedger = parseTradeLedger(storedLedgerRow);
        if (!sameFill(storedLedger, numericFill, sellKind) ||
            storedLedger.baseRatioAtBuy !== ledger.baseRatioAtBuy) {
          throw new Error("成交台账已存在冲突内容，拒绝覆盖");
        }

        const notification = buildTradeFillNotificationEvent(numericFill, now);
        const notificationPayload = JSON.stringify(notification);
        this.run(
          `INSERT INTO notification_outbox(
            id, payload_json, state, attempt, next_attempt_at, created_at, updated_at
          ) VALUES (?, ?, 'pending', 0, 0, ?, ?)
          ON CONFLICT(id) DO NOTHING`,
          notification.id, notificationPayload, now, now,
        );
        const storedNotification = this.get(
          "SELECT payload_json FROM notification_outbox WHERE id = ?",
          notification.id,
        );
        if (!storedNotification || storedNotification.payload_json !== notificationPayload) {
          throw new Error("成交Outbox事件ID已存在但载荷不同，拒绝覆盖");
        }
      }

      const expectedCount = this.get(
        "SELECT COUNT(*) AS total FROM fills WHERE intent_id = ? AND attempt = ? AND order_id = ?",
        input.intentId, input.attempt, input.exchangeOrderId,
      );
      if (Number(expectedCount?.total ?? 0) !== input.fills.length) {
        throw new Error("成交账本数量与本次终态快照不一致，拒绝释放资金");
      }
      const consumed = intent.side === "BUY"
        ? sumDecimals([input.cumulativeQuoteQty, quoteCommission])
        : sumDecimals([input.executedQty, baseCommission]);
      if (compareDecimal(consumed, String(reservation.amount)) > 0) {
        throw new Error("实际消耗超过资金预留，保留账户锁并转人工复核");
      }
      if (input.exchangeStatus === "FILLED" && intent.side === "SELL" &&
          compareDecimal(input.executedQty, intent.amount) !== 0) {
        throw new Error("SELL FILLED数量与原始委托数量不一致，拒绝释放");
      }

      const nextState: ServerExecutionIntent["state"] = input.exchangeStatus === "FILLED"
        ? "filled"
        : compareDecimal(input.executedQty, "0") > 0
          ? "partial_terminal"
          : input.exchangeStatus === "CANCELED" ? "canceled"
            : input.exchangeStatus === "EXPIRED" || input.exchangeStatus === "EXPIRED_IN_MATCH"
              ? "expired" : "rejected";

      this.run(
        `INSERT INTO exchange_orders(
          exchange_order_id, intent_id, attempt, client_order_id, symbol, side, status,
          requested_amount, executed_qty, cumulative_quote_qty, exchange_time, exchange_update_time, reconciled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(exchange_order_id) DO NOTHING`,
        input.exchangeOrderId, input.intentId, input.attempt, intent.clientOrderId,
        intent.symbol, intent.side, input.exchangeStatus, intent.amount,
        input.executedQty, input.cumulativeQuoteQty, input.exchangeTerminalAt, now,
      );
      const storedOrder = this.get("SELECT * FROM exchange_orders WHERE exchange_order_id = ?", input.exchangeOrderId);
      if (!storedOrder || storedOrder.intent_id !== input.intentId ||
          Number(storedOrder.attempt) !== input.attempt || storedOrder.client_order_id !== intent.clientOrderId ||
          storedOrder.symbol !== intent.symbol || storedOrder.side !== intent.side ||
          storedOrder.status !== input.exchangeStatus ||
          storedOrder.requested_amount !== intent.amount ||
          storedOrder.executed_qty !== input.executedQty ||
          storedOrder.cumulative_quote_qty !== input.cumulativeQuoteQty ||
          Number(storedOrder.exchange_update_time) !== input.exchangeTerminalAt) {
        throw new Error("交易所订单ID已存在但订单事实冲突");
      }

      if (this.run(
        "UPDATE reservations SET consumed_amount = ?, state = 'settled', updated_at = ? WHERE intent_id = ? AND attempt = ? AND state = 'reserved'",
        consumed, now, input.intentId, input.attempt,
      ) !== 1) throw new Error("资金预留状态已变化，拒绝结算");
      if (this.run(
        `UPDATE order_intents SET state = ?, exchange_order_id = ?, exchange_terminal_at = ?,
          fills_reconciled_at = ?, updated_at = ?, last_error = NULL
          WHERE intent_id = ? AND attempt = ? AND state IN ('submitting', 'unknown', 'reconciling')`,
        nextState, input.exchangeOrderId, input.exchangeTerminalAt,
        Math.max(now, input.exchangeTerminalAt), now, input.intentId, input.attempt,
      ) !== 1) throw new Error("订单状态已变化，拒绝终态写入");
      if (this.run(
        "UPDATE order_attempts SET state = ?, exchange_order_id = ?, updated_at = ? WHERE intent_id = ? AND attempt = ? AND lease_token = ?",
        nextState, input.exchangeOrderId, now, input.intentId, input.attempt, input.leaseToken,
      ) !== 1) throw new Error("订单attempt租约已变化，拒绝终态写入");
      if (this.run(
        "DELETE FROM account_lock WHERE singleton = 1 AND intent_id = ? AND attempt = ? AND lease_token = ?",
        input.intentId, input.attempt, input.leaseToken,
      ) !== 1) throw new Error("账户锁已变化，拒绝释放");
      this.run(
        "INSERT INTO audit_events(intent_id, event_type, created_at) VALUES (?, 'intent_terminal_reconciled_and_released', ?)",
        input.intentId, now,
      );
      const updated = this.get("SELECT * FROM order_intents WHERE intent_id = ?", input.intentId);
      if (!updated) throw new Error("订单终态写入后无法读取");
      return parseIntent(updated);
    });
  }

  async markManualReview(input: ExecutionLeaseInput & { reason: string }): Promise<void> {
    if (!validTime(input.now) || !input.reason) throw new Error("人工复核状态参数无效");
    this.transaction(() => {
      const lock = this.get(
        "SELECT lease_until FROM account_lock WHERE singleton = 1 AND intent_id = ? AND attempt = ? AND lease_token = ?",
        input.intentId, input.attempt, input.leaseToken,
      );
      if (!lock || Number(lock.lease_until) <= input.now) throw new Error("账户租约已失效，拒绝写入人工复核状态");
      this.run(
        "UPDATE order_intents SET state = 'manual_review', last_error = ?, updated_at = ? WHERE intent_id = ? AND attempt = ?",
        input.reason.slice(0, 500), input.now, input.intentId, input.attempt,
      );
      this.run(
        "UPDATE order_attempts SET state = 'manual_review', updated_at = ? WHERE intent_id = ? AND attempt = ? AND lease_token = ?",
        input.now, input.intentId, input.attempt, input.leaseToken,
      );
      this.run(
        "UPDATE reservations SET state = 'manual_review', updated_at = ? WHERE intent_id = ? AND attempt = ? AND state = 'reserved'",
        input.now, input.intentId, input.attempt,
      );
      this.run(
        "INSERT INTO audit_events(intent_id, event_type, payload_hash, created_at) VALUES (?, 'intent_manual_review', ?, ?)",
        input.intentId, input.reason.slice(0, 160), input.now,
      );
      // 故意保留account_lock和资金预留，等待人工核对。
    });
  }

  private async enqueueTask(input: SchedulerTaskInput, now: number): Promise<{ created: boolean }> {
    if (!validateSchedulerTaskInput(input, now)) throw new Error("调度任务输入无效");
    return this.transaction(() => {
      const created = this.run(
        `INSERT INTO scheduler_tasks(
          task_id, task_type, due_at, state, attempt, next_attempt_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'pending', 0, 0, ?, ?)
        ON CONFLICT(task_id) DO NOTHING`,
        input.taskId, input.taskType, input.dueAt, now, now,
      );
      const existing = this.get("SELECT task_type, due_at FROM scheduler_tasks WHERE task_id = ?", input.taskId);
      if (!existing || existing.task_type !== input.taskType || Number(existing.due_at) !== input.dueAt) {
        throw new Error("调度taskId已存在但任务内容冲突");
      }
      return { created: created === 1 };
    });
  }

  private async claimDueTasks(input: {
    now: number; leaseMs: number; limit: number; taskType?: SchedulerTaskInput["taskType"];
  }): Promise<SchedulerTaskLease[]> {
    if (!validTime(input.now) || !Number.isSafeInteger(input.leaseMs) ||
        input.leaseMs < 1_000 || input.leaseMs > 120_000 ||
        !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error("调度任务领取参数无效");
    }
    return this.transaction(() => {
      const rows = this.all(
        `SELECT * FROM scheduler_tasks
         WHERE state = 'pending' AND due_at <= ? AND next_attempt_at <= ?
           AND (? IS NULL OR task_type = ?)
         ORDER BY MAX(due_at, next_attempt_at), created_at
         LIMIT ?`,
        input.now, input.now, input.taskType ?? null, input.taskType ?? null, input.limit,
      );
      const claimed: SchedulerTaskLease[] = [];
      for (const row of rows) {
        const attempt = Number(row.attempt) + 1;
        const leaseToken = randomUUID();
        const leaseUntil = input.now + input.leaseMs;
        const changed = this.run(
          `UPDATE scheduler_tasks
           SET state = 'leased', attempt = ?, lease_token = ?, lease_until = ?, updated_at = ?
           WHERE task_id = ? AND state = 'pending' AND attempt = ?
             AND due_at <= ? AND next_attempt_at <= ?`,
          attempt, leaseToken, leaseUntil, input.now, String(row.task_id),
          Number(row.attempt), input.now, input.now,
        );
        if (changed !== 1) continue;
        claimed.push({
          taskId: String(row.task_id),
          taskType: String(row.task_type) as SchedulerTaskLease["taskType"],
          dueAt: Number(row.due_at),
          attempt,
          leaseToken,
          leaseUntil,
        });
      }
      return claimed;
    });
  }

  private async renewTaskLease(lease: SchedulerTaskLease, now: number, leaseMs: number): Promise<boolean> {
    if (!validTime(now) || !Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 120_000) {
      throw new Error("调度租约续期参数无效");
    }
    return this.run(
      `UPDATE scheduler_tasks SET lease_until = ?, updated_at = ?
       WHERE task_id = ? AND state = 'leased' AND attempt = ?
         AND lease_token = ? AND lease_until > ?`,
      now + leaseMs, now, lease.taskId, lease.attempt, lease.leaseToken, now,
    ) === 1;
  }

  private async ackTask(lease: SchedulerTaskLease, now: number): Promise<boolean> {
    if (!validTime(now)) throw new Error("调度任务确认时间无效");
    const changed = this.run(
      `UPDATE scheduler_tasks
       SET state = 'completed', lease_until = NULL, next_attempt_at = 0,
           last_error = NULL, updated_at = ?
       WHERE task_id = ? AND state = 'leased' AND attempt = ?
         AND lease_token = ? AND lease_until > ?`,
      now, lease.taskId, lease.attempt, lease.leaseToken, now,
    );
    if (changed === 1) return true;
    const existing = this.get(
      "SELECT state, attempt, lease_token FROM scheduler_tasks WHERE task_id = ?",
      lease.taskId,
    );
    return existing?.state === "completed" &&
      Number(existing.attempt) === lease.attempt &&
      existing.lease_token === lease.leaseToken;
  }

  private async retryTask(
    lease: SchedulerTaskLease,
    now: number,
    reason: string,
  ): Promise<"pending" | "manual_review" | "lease_lost"> {
    if (!validTime(now) || !reason) throw new Error("调度任务重试参数无效");
    return this.transaction(() => {
      const current = this.get("SELECT * FROM scheduler_tasks WHERE task_id = ?", lease.taskId);
      if (!current || current.state !== "leased" || Number(current.attempt) !== lease.attempt ||
          current.lease_token !== lease.leaseToken || Number(current.lease_until) <= now) {
        return "lease_lost";
      }
      const retryAt = schedulerTaskRetryAt(lease.attempt, now);
      if (retryAt === null) {
        this.run(
          `UPDATE scheduler_tasks SET state = 'manual_review', lease_token = NULL,
           lease_until = NULL, last_error = ?, updated_at = ?
           WHERE task_id = ? AND state = 'leased' AND attempt = ? AND lease_token = ?`,
          reason.slice(0, 500), now, lease.taskId, lease.attempt, lease.leaseToken,
        );
        return "manual_review";
      }
      this.run(
        `UPDATE scheduler_tasks SET state = 'pending', lease_token = NULL,
         lease_until = NULL, next_attempt_at = ?, last_error = ?, updated_at = ?
         WHERE task_id = ? AND state = 'leased' AND attempt = ? AND lease_token = ?`,
        retryAt, reason.slice(0, 500), now, lease.taskId, lease.attempt, lease.leaseToken,
      );
      return "pending";
    });
  }

  private async recoverExpiredTasks(now: number): Promise<number> {
    if (!validTime(now)) throw new Error("过期调度租约恢复时间无效");
    return this.transaction(() => {
      const rows = this.all(
        "SELECT task_id, attempt FROM scheduler_tasks WHERE state = 'leased' AND lease_until <= ? ORDER BY lease_until LIMIT 500",
        now,
      );
      let recovered = 0;
      for (const row of rows) {
        const attempt = Number(row.attempt);
        const decision = expiredSchedulerLeaseDecision(attempt, now);
        if (decision.state === "manual_review") {
          recovered += this.run(
            `UPDATE scheduler_tasks SET state = 'manual_review', lease_token = NULL,
             lease_until = NULL, last_error = '租约过期且达到最大尝试次数', updated_at = ?
             WHERE task_id = ? AND state = 'leased' AND attempt = ? AND lease_until <= ?`,
            now, String(row.task_id), attempt, now,
          );
        } else {
          recovered += this.run(
            `UPDATE scheduler_tasks SET state = 'pending', lease_token = NULL,
             lease_until = NULL, next_attempt_at = ?, last_error = '租约过期，等待退避后重试',
             updated_at = ? WHERE task_id = ? AND state = 'leased' AND attempt = ? AND lease_until <= ?`,
            decision.nextAttemptAt, now, String(row.task_id), attempt, now,
          );
        }
      }
      return recovered;
    });
  }

  private async reserveSellEvent(record: SellEventRecord): Promise<{ record: SellEventRecord; created: boolean }> {
    if (!record.eventKey || !record.symbol || !record.kind ||
        !Number.isFinite(record.requestedQty) || record.requestedQty <= 0 ||
        !validTime(record.createdAt) || !validTime(record.updatedAt) ||
        !Array.isArray(record.fillIds) || !record.fillIds.every((id) => typeof id === "string")) {
      throw new Error("卖出事件字段无效");
    }
    return this.transaction(() => {
      const created = this.run(
        `INSERT INTO sell_events(
          event_key, symbol, kind, status, requested_qty, filled_qty, created_at, updated_at,
          exchange_order_id, client_order_id, fill_ids_json, last_error,
          exchange_terminal_status, fill_reconcile_completed_at, lot_step_size
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_key) DO NOTHING`,
        record.eventKey, record.symbol, record.kind, record.status, record.requestedQty,
        record.filledQty ?? null, record.createdAt, record.updatedAt, record.exchangeOrderId,
        record.clientOrderId ?? null, JSON.stringify(record.fillIds), record.lastError,
        record.exchangeTerminalStatus ?? null, record.fillReconcileCompletedAt ?? null,
        record.lotStepSize ?? null,
      );
      const existing = this.get("SELECT * FROM sell_events WHERE event_key = ?", record.eventKey);
      if (!existing || existing.symbol !== record.symbol || existing.kind !== record.kind ||
          Number(existing.requested_qty) !== record.requestedQty) {
        throw new Error("卖出事件幂等键冲突，拒绝覆盖不同事件");
      }
      return { record: parseSellEvent(existing), created: created === 1 };
    });
  }

  private async updateSellEvent(record: SellEventRecord): Promise<void> {
    this.transaction(() => {
      const row = this.get("SELECT * FROM sell_events WHERE event_key = ?", record.eventKey);
      if (!row) throw new Error("卖出事件不存在");
      const current = parseSellEvent(row);
      const transitions: Record<SellEventRecord["status"], SellEventRecord["status"][]> = {
        pending: ["pending", "reconcile_required", "partially_filled", "executed", "blocked"],
        reconcile_required: ["reconcile_required", "partially_filled", "executed", "blocked"],
        partially_filled: ["partially_filled", "reconcile_required", "executed", "blocked"],
        blocked: ["blocked"],
        executed: ["executed"],
      };
      if (!transitions[current.status].includes(record.status) ||
          current.symbol !== record.symbol || current.kind !== record.kind ||
          current.requestedQty !== record.requestedQty ||
          (current.exchangeOrderId && current.exchangeOrderId !== record.exchangeOrderId) ||
          (current.clientOrderId && current.clientOrderId !== record.clientOrderId) ||
          ((record.status === "executed" || record.status === "partially_filled") && record.fillIds.length === 0)) {
        throw new Error("卖出事件状态转换、数量或订单标识冲突");
      }
      const fillIds = [...new Set([...current.fillIds, ...record.fillIds])];
      this.run(
        `UPDATE sell_events SET status = ?, filled_qty = ?, updated_at = ?, exchange_order_id = ?,
          client_order_id = ?, fill_ids_json = ?, last_error = ?, exchange_terminal_status = ?,
          fill_reconcile_completed_at = ?, lot_step_size = ?
          WHERE event_key = ?`,
        record.status, record.filledQty ?? null, record.updatedAt, record.exchangeOrderId,
        record.clientOrderId ?? null, JSON.stringify(fillIds), record.lastError,
        record.exchangeTerminalStatus ?? null, record.fillReconcileCompletedAt ?? null,
        record.lotStepSize ?? null, record.eventKey,
      );
    });
  }

  private async listSellEvents(): Promise<SellEventRecord[]> {
    return this.all("SELECT * FROM sell_events ORDER BY created_at ASC").map(parseSellEvent);
  }

  private async claimSellEventForSubmission(
    eventKey: string,
    clientOrderId: string,
    now = Date.now(),
  ): Promise<SellEventRecord> {
    if (!eventKey || !/^[A-Za-z0-9_-]{1,36}$/.test(clientOrderId) || !validTime(now)) {
      throw new Error("卖出事件或客户端订单ID无效");
    }
    return this.transaction(() => {
      const row = this.get("SELECT * FROM sell_events WHERE event_key = ?", eventKey);
      if (!row) throw new Error("卖出事件不存在");
      const current = parseSellEvent(row);
      if (current.status !== "pending" || current.clientOrderId || current.exchangeOrderId) {
        throw new Error("卖出事件已被领取或已有订单标识；必须先对账，禁止重复提交");
      }
      this.run(
        "UPDATE sell_events SET status = 'reconcile_required', client_order_id = ?, last_error = ?, updated_at = ? WHERE event_key = ? AND status = 'pending' AND client_order_id IS NULL AND exchange_order_id IS NULL",
        clientOrderId, "卖单提交状态待Binance对账；禁止再次提交", now, eventKey,
      );
      const updated = this.get("SELECT * FROM sell_events WHERE event_key = ?", eventKey);
      if (!updated) throw new Error("领取卖出事件后无法读取");
      return parseSellEvent(updated);
    });
  }

  private async bindSellEventToExchangeOrder(
    eventKey: string,
    exchangeOrderId: string,
    now = Date.now(),
  ): Promise<SellEventRecord> {
    if (!eventKey || !/^[0-9]{1,32}$/.test(exchangeOrderId) || !validTime(now)) {
      throw new Error("卖出事件或Binance订单ID无效");
    }
    return this.transaction(() => {
      const row = this.get("SELECT * FROM sell_events WHERE event_key = ?", eventKey);
      if (!row) throw new Error("卖出事件不存在");
      const current = parseSellEvent(row);
      if (!["pending", "reconcile_required"].includes(current.status) ||
          (current.exchangeOrderId && current.exchangeOrderId !== exchangeOrderId)) {
        throw new Error("卖出事件状态不允许绑定订单，或订单ID已绑定");
      }
      this.run(
        "UPDATE sell_events SET exchange_order_id = ?, updated_at = ?, last_error = NULL WHERE event_key = ?",
        exchangeOrderId, now, eventKey,
      );
      const updated = this.get("SELECT * FROM sell_events WHERE event_key = ?", eventKey);
      if (!updated) throw new Error("绑定卖出订单后无法读取");
      return parseSellEvent(updated);
    });
  }

  private async listTradeLedger(): Promise<TradeLedgerEntry[]> {
    return this.all("SELECT * FROM trade_ledger ORDER BY time ASC, id ASC").map(parseTradeLedger);
  }

  private async recordConfirmedSellFill(
    fill: ExecutionFill,
    sellKind: NonNullable<TradeLedgerEntry["sellKind"]>,
  ): Promise<{ recorded: boolean; ledger: TradeLedgerEntry }> {
    if (fill.side !== "SELL" || !fill.fillId || !fill.orderId || !fill.symbol ||
        !["take_profit", "indicator_profit", "trail_stop", "base_reduce"].includes(sellKind) ||
        ![fill.time, fill.price, fill.qty, fill.quoteQty, fill.commission, fill.commissionUsdt].every(Number.isFinite) ||
        fill.time <= 0 || fill.price <= 0 || fill.qty <= 0 || fill.quoteQty <= 0 ||
        fill.commission < 0 || fill.commissionUsdt < 0) {
      throw new Error("已确认卖出成交字段无效");
    }
    return this.transaction(() => {
      const id = `${fill.symbol}:${fill.fillId}`;
      const existingFill = this.get("SELECT * FROM fills WHERE symbol = ? AND trade_id = ?", fill.symbol, fill.fillId);
      const existingLedgerRow = this.get("SELECT * FROM trade_ledger WHERE symbol = ? AND fill_id = ?", fill.symbol, fill.fillId);
      if (existingFill || existingLedgerRow) {
        if (!existingFill || !existingLedgerRow) {
          throw new Error("成交去重索引与台账记录不一致，暂停卖出记账");
        }
        const existingLedger = parseTradeLedger(existingLedgerRow);
        if (!sameFill(existingLedger, fill, sellKind) ||
            existingFill.order_id !== fill.orderId || existingFill.side !== "SELL" ||
            existingFill.price !== String(fill.price) || existingFill.qty !== String(fill.qty) ||
            existingFill.quote_qty !== String(fill.quoteQty) ||
            existingFill.commission !== String(fill.commission) ||
            existingFill.commission_asset !== fill.commissionAsset) {
          throw new Error("已入账的Binance成交ID再次返回不同内容或卖出分类，暂停记账");
        }
        return { recorded: false, ledger: existingLedger };
      }
      this.run(
        `INSERT INTO fills(
          symbol, trade_id, intent_id, attempt, order_id, side, price, qty, quote_qty,
          commission, commission_asset, commission_usdt, filled_at, sell_kind
        ) VALUES (?, ?, NULL, NULL, ?, 'SELL', ?, ?, ?, ?, ?, ?, ?, ?)`,
        fill.symbol, fill.fillId, fill.orderId, String(fill.price), String(fill.qty),
        String(fill.quoteQty), String(fill.commission), fill.commissionAsset,
        String(fill.commissionUsdt), fill.time, sellKind,
      );
      this.run(
        `INSERT INTO trade_ledger(
          id, symbol, fill_id, order_id, side, time, price, qty, quote_qty,
          commission, commission_asset, commission_usdt, realized_pnl_usdt, sell_kind
        ) VALUES (?, ?, ?, ?, 'SELL', ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        id, fill.symbol, fill.fillId, fill.orderId, fill.time, fill.price, fill.qty,
        fill.quoteQty, fill.commission, fill.commissionAsset, fill.commissionUsdt, sellKind,
      );
      const notification = buildTradeFillNotificationEvent(fill);
      this.run(
        `INSERT INTO notification_outbox(
          id, payload_json, state, attempt, next_attempt_at, created_at, updated_at
        ) VALUES (?, ?, 'pending', 0, 0, ?, ?)`,
        notification.id, JSON.stringify(notification), notification.createdAt, notification.updatedAt,
      );
      const ledger = this.get("SELECT * FROM trade_ledger WHERE id = ?", id);
      if (!ledger) throw new Error("卖出成交写入后无法读取台账");
      return { recorded: true, ledger: parseTradeLedger(ledger) };
    });
  }

  close(): void {
    this.database.close();
  }
}

export async function openLocalExecutionStore(
  options: LocalExecutionDatabaseOptions = {},
): Promise<SqliteExecutionStore> {
  return SqliteExecutionStore.open(options);
}
