import type { BuyFundsReservation } from "../fund-reservation";
import type { ExecutionFill, QueuedBuyOrder, TradeLedgerEntry } from "../types";
import type { SellEventRecord } from "../sell-store.browser";
import type {
  ExecutionLease,
  ServerExecutionIntent,
} from "../server-execution-core";

/**
 * 本地常驻执行器的持久化接口契约。
 *
 * 实现位于Node.js服务端，底层使用node:sqlite；本文件只定义领域接口，
 * 不导入SQLite实现，也不在浏览器端使用。所有复合写入由实现内部单个
 * SQLite事务完成，事务回调不得执行网络请求或await。
 */

export interface CreateIntentResult {
  intent: ServerExecutionIntent;
  created: boolean;
}

export interface IntentClaimInput {
  intentId: string;
  /** 调用方刚取得的Binance可用余额快照，十进制字符串。 */
  availableAsset: string;
  availableAmount: string;
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
  fills: Array<{
    tradeId: string;
    orderId: string;
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

export interface SchedulerTaskLease {
  taskId: string;
  taskType: SchedulerTaskInput["taskType"];
  dueAt: number;
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
  recoverExpired(now: number): Promise<number>;
}

export interface SellEventRepository {
  /** 同eventKey只允许首次创建；重复调用返回既有记录，不覆盖其状态。 */
  reserveSellEvent(record: SellEventRecord): Promise<{ record: SellEventRecord; created: boolean }>;
  /** 校验状态机、symbol/kind/数量及订单标识不可变性后更新。 */
  updateSellEvent(record: SellEventRecord): Promise<void>;
  listSellEvents(): Promise<SellEventRecord[]>;
  /** 在单事务内将pending事件锁为reconcile_required并持久化唯一clientOrderId。 */
  claimSellEventForSubmission(eventKey: string, clientOrderId: string, now?: number): Promise<SellEventRecord>;
  /** 只允许将已领取事件绑定到同一个交易所订单ID；订单ID不可改写。 */
  bindSellEventToExchangeOrder(eventKey: string, exchangeOrderId: string, now?: number): Promise<SellEventRecord>;
}

export interface TradeLedgerRepository {
  listTradeLedger(): Promise<TradeLedgerEntry[]>;
  /** fill去重、成交台账和成交通知Outbox必须同一SQLite事务提交。 */
  recordConfirmedSellFill(
    fill: ExecutionFill,
    sellKind: NonNullable<TradeLedgerEntry["sellKind"]>,
  ): Promise<{ recorded: boolean; ledger: TradeLedgerEntry }>;
}

export interface BuyOrderRepository {
  listBuyOrders(): Promise<QueuedBuyOrder[]>;
  enqueueBuyOrder(order: QueuedBuyOrder): Promise<{ order: QueuedBuyOrder; created: boolean }>;
  saveBuyOrder(order: QueuedBuyOrder): Promise<void>;
  /** BUY fill、去重索引、台账、成本/队列进度、资金预留消耗及Outbox原子提交。 */
  recordConfirmedBuyFill(
    fill: ExecutionFill,
    queuedOrderId: string,
    expectedAttempt?: number,
  ): Promise<{ recorded: boolean; ledger: TradeLedgerEntry; order: QueuedBuyOrder }>;
}

export interface BuyReservationRepository {
  listBuyFundsReservations(): Promise<BuyFundsReservation[]>;
  reserveBuyFunds(input: Record<string, unknown>): Promise<unknown>;
  reserveAndClaimBuyOrderSubmission(input: Record<string, unknown>): Promise<unknown>;
  applyConfirmedBuyReservationSpend(input: Record<string, unknown>): Promise<unknown>;
  releaseBuyFundsReservation(input: Record<string, unknown>): Promise<unknown>;
}

/** 常驻Trader及SELL自动化共用的本地持久化边界。 */
export interface LocalExecutionStore {
  readonly scheduler: SchedulerTaskRepository;
  readonly sellEvents: SellEventRepository;
  readonly tradeLedger: TradeLedgerRepository;
  readonly buyOrders: BuyOrderRepository;
  readonly buyReservations: BuyReservationRepository;

  createIntent(intent: ServerExecutionIntent): Promise<CreateIntentResult>;
  getIntent(intentId: string): Promise<ServerExecutionIntent | null>;
  listRunnableIntents(now: number, limit: number): Promise<ServerExecutionIntent[]>;
  claimIntent(input: IntentClaimInput): Promise<IntentClaimResult | null>;
  renewExecutionLease(lease: ExecutionLeaseInput, leaseMs: number): Promise<boolean>;
  markSubmitting(input: MarkSubmittingInput): Promise<ServerExecutionIntent>;
  markUnknown(input: MarkUnknownInput): Promise<ServerExecutionIntent>;
  takeoverForReconciliation(lease: ExecutionLeaseInput, leaseMs: number): Promise<ExecutionLease | null>;
  getReconcileContext(intentId: string): Promise<ReconcileContext | null>;
  /** fill唯一性、累计成交核对、reservation结算、终态状态和账户锁释放必须同事务。 */
  finalizeReconciledOrder(input: FinalizeReconciledOrderInput): Promise<ServerExecutionIntent>;
  markManualReview(input: ExecutionLeaseInput & { reason: string }): Promise<void>;

  close(): void;
}
