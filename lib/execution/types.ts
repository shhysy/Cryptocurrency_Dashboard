export type QueueStatus =
  | "pending"
  | "partially_filled"
  | "filled"
  | "blocked"
  | "reconcile_required"
  | "cancelled";

export interface BuyOrderIntent {
  /** Stable strategy event key: symbol + head/add/reserve tier + originating candle/event. */
  eventKey: string;
  symbol: string;
  quoteAsset: "USDT";
  strategyLabel: string;
  plannedUsdt: number;
  referencePrice: number;
  createdAt: number;
  strategyVersion: "V3.3";
}

export interface QueuedBuyOrder extends BuyOrderIntent {
  id: string;
  status: QueueStatus;
  filledUsdt: number;
  remainingUsdt: number;
  attemptCount: number;
  lastAttemptAt: number | null;
  lastError: string | null;
  updatedAt: number;
}

export interface ExecutionFill {
  /** Exchange trade id / fill id. Unique within symbol and order. */
  fillId: string;
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  time: number;
  price: number;
  qty: number;
  quoteQty: number;
  commission: number;
  commissionAsset: string;
  commissionUsdt: number;
}

export interface TradeLedgerEntry extends ExecutionFill {
  id: string;
  realizedPnlUsdt: number | null;
}

export interface BuyExecutionPlan {
  executableUsdt: number;
  estimatedQty: number;
  remainingUsdt: number;
  status: "ready" | "wait_balance" | "below_min_notional" | "cap_reached";
}
