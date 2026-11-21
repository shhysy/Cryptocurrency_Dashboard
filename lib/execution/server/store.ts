import type { ExecutionFill, TradeLedgerEntry } from "../types";
import type { SellEventRecord } from "../sell-store.browser";
import type { ExecutionLease, ServerExecutionIntent } from "../server-execution-core";
import type { SystemAlertNotificationEvent, TradeNotificationOutboxEvent } from "../notification-outbox";

/**
 * 本地常驻执行器持久化接口。实现使用Node.js node:sqlite。
 * 复合写入由实现内部单个SQLite事务完成；事务内禁止网络IO、await和交易所请求。
 */

export interface CreateIntentResult {
  intent: ServerExecutionIntent;
  created: boolean;
}

export interface IntentClaimInput {
  intentId: string;
  availableAsset: string;
  availableAmount: string;
  snapshotAt: number;
  now: number;
  leaseMs: number;
}

export interface IntentClaimResult {
  intent: ServerExecutionIntent;
  lease: ExecutionLease;
  reservationId: string;
  reservedAsset: string;
  reservedAmount: string;
}

export interface ExecutionLeaseInput {
  intentId: string;
  attempt: number;
  leaseToken: string;
  now: number;
}

export interface MarkSubmittingInput extends ExecutionLeaseInput {
  clientOrderId: string;
}

export interface MarkUnknownInput extends ExecutionLeaseInput {
  reason: string;
}

export interface ReconcileContext {
  intent: ServerExecutionIntent;
  lease: ExecutionLease | null;
  reservedAsset: string | null;
  reservedAmount: string | null;
}

export interface FinalizeReconciledOrderInput extends ExecutionLeaseInput {
  exchangeOrderId: string;
  exchangeStatus: "FILLED" | "CANCELED" | "EXPIRED" | "EXPIRED_IN_MATCH" | "REJECTED";
  executedQty: string;
  cumulativeQuoteQty: string;
  exchangeTerminalAt: number;
  schedulerLease?: SchedulerTaskLease;
  fills: Array<{
    tradeId: string;
    orderId: string;
    price: string;
    qty: string;
    quoteQty: string;
    commission: string;
    commissionAsset: string;
    filledAt: number;
  }>;
}

export interface SchedulerTaskInput {
  taskId: string;
  taskType: "reconcile_intent" | "health_check";
  dueAt: number;
}

export interface SchedulerTaskLease extends SchedulerTaskInput {
  attempt: number;
  leaseToken: string;
  leaseUntil: number;
}

export interface SchedulerTaskRepository {
  enqueue(input: SchedulerTaskInput, now: number): Promise<{ created: boolean }>;
  claimDue(input: {
    now: number;
    leaseMs: number;
    limit: number;
    taskType?: SchedulerTaskInput["taskType"];
  }): Promise<SchedulerTaskLease[]>;
  renew(lease: SchedulerTaskLease, now: number, leaseMs: number): Promise<boolean>;
  ack(lease: SchedulerTaskLease, now: number): Promise<boolean>;
  retry(lease: SchedulerTaskLease, now: number, reason: string): Promise<"pending" | "manual_review" | "lease_lost">;
  /** 交易所订单仍为NEW/PARTIALLY_FILLED时按固定间隔重排，不累计故障重试次数。 */
  defer(lease: SchedulerTaskLease, now: number, delayMs: number, reason: string): Promise<boolean>;
  recoverExpired(now: number): Promise<number>;
}

export interface SellEventRepository {
  reserveSellEvent(record: SellEventRecord): Promise<{ record: SellEventRecord; created: boolean }>;
  updateSellEvent(record: SellEventRecord): Promise<void>;
  listSellEvents(): Promise<SellEventRecord[]>;
  claimSellEventForSubmission(eventKey: string, clientOrderId: string, now?: number): Promise<SellEventRecord>;
  bindSellEventToExchangeOrder(eventKey: string, exchangeOrderId: string, now?: number): Promise<SellEventRecord>;
}

export interface TradeLedgerRepository {
  listTradeLedger(): Promise<TradeLedgerEntry[]>;
  /** BUY GTC开放订单逐笔真实成交入账，保留交易所原始十进制字符串。 */
  recordConfirmedBuyFill(input: {
    fill: {
      tradeId: string;
      orderId: string;
      symbol: string;
      price: string;
      qty: string;
      quoteQty: string;
      commission: string;
      commissionUsdt: string;
      commissionAsset: string;
      filledAt: number;
    };
    intentId: string;
    attempt: number;
    leaseToken: string;
    schedulerLease: SchedulerTaskLease;
    now: number;
  }): Promise<{ recorded: boolean; ledger: TradeLedgerEntry }>;
  /** 成交fill、台账与通知Outbox必须在同一事务内写入。 */
  recordConfirmedSellFill(
    fill: ExecutionFill,
    sellKind: NonNullable<TradeLedgerEntry["sellKind"]>,
  ): Promise<{ recorded: boolean; ledger: TradeLedgerEntry }>;
}

export interface NotificationOutboxLease {
  event: TradeNotificationOutboxEvent;
  leaseToken: string;
}

export interface NotificationOutboxRepository {
  enqueueSystemAlert(event: SystemAlertNotificationEvent): Promise<{ created: boolean }>;
  claimDue(input: { now: number; leaseMs: number; limit: number; eventTypes?: Array<TradeNotificationOutboxEvent["type"]> }): Promise<NotificationOutboxLease[]>;
  markSent(input: { id: string; leaseToken: string; now: number }): Promise<boolean>;
  markFailed(input: { id: string; leaseToken: string; now: number; reason: string }): Promise<"pending" | "manual_review" | "lease_lost">;
}

export interface LocalExecutionStore {
  countExecutionManualReview(): Promise<number>;
  readonly scheduler: SchedulerTaskRepository;
  readonly sellEvents: SellEventRepository;
  readonly tradeLedger: TradeLedgerRepository;
  readonly notificationOutbox: NotificationOutboxRepository;

  createIntent(intent: ServerExecutionIntent): Promise<CreateIntentResult>;
  getIntent(intentId: string): Promise<ServerExecutionIntent | null>;
  listRunnableIntents(now: number, limit: number): Promise<ServerExecutionIntent[]>;
  /** 余额快照、账户锁、reservation、attempt和lease必须原子领取。 */
  claimIntent(input: IntentClaimInput): Promise<IntentClaimResult | null>;
  renewExecutionLease(lease: ExecutionLeaseInput, leaseMs: number): Promise<boolean>;
  /** POST之前持久化clientOrderId和submitting；同一attempt不可再次提交。 */
  markSubmitting(input: MarkSubmittingInput): Promise<ServerExecutionIntent>;
  /** 结果不明只冻结并排队对账，绝不创建新attempt或盲目重发。 */
  markUnknown(input: MarkUnknownInput): Promise<ServerExecutionIntent>;
  /** 过期账户租约只允许reconcile-only接管，不恢复POST权限。 */
  takeoverForReconciliation(lease: ExecutionLeaseInput, leaseMs: number): Promise<ExecutionLease | null>;
  getReconcileContext(intentId: string): Promise<ReconcileContext | null>;
  /** fill唯一性、成交核对、reservation结算、订单终态、账户锁释放必须同事务。 */
  finalizeReconciledOrder(input: FinalizeReconciledOrderInput): Promise<ServerExecutionIntent>;
  markManualReview(input: ExecutionLeaseInput & { reason: string }): Promise<void>;
  close(): void;
}
