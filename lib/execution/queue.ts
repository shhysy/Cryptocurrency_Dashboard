import type { BuyExecutionPlan, BuyOrderIntent, QueuedBuyOrder } from "./types";

const EPSILON = 1e-8;

/** Deterministic id prevents a repeated dashboard refresh from enqueueing the same strategy event twice. */
export function strategyEventId(eventKey: string): string {
  return `v33-${encodeURIComponent(eventKey)}`;
}

export function createQueuedBuy(intent: BuyOrderIntent, now = Date.now()): QueuedBuyOrder {
  if (!intent.eventKey || !intent.symbol || intent.quoteAsset !== "USDT") throw new Error("买入订单缺少必要标识或报价资产不是 USDT");
  if (!Number.isFinite(intent.plannedUsdt) || intent.plannedUsdt <= 0) throw new Error("计划金额必须大于 0");
  if (!Number.isFinite(intent.referencePrice) || intent.referencePrice <= 0) throw new Error("参考价格无效");
  return {
    ...intent,
    id: strategyEventId(intent.eventKey),
    status: "pending",
    filledUsdt: 0,
    remainingUsdt: intent.plannedUsdt,
    attemptCount: 0,
    lastAttemptAt: null,
    lastError: null,
    updatedAt: now,
  };
}

/**
 * USDT-only partial execution planner.
 * Does not submit orders; caller must re-check free USDT, symbol filters and the fixed coin cap immediately before submission.
 */
export function planPartialBuy(
  order: QueuedBuyOrder,
  freeUsdt: number,
  remainingCoinCapUsdt: number,
  minNotionalUsdt: number,
): BuyExecutionPlan {
  const remaining = Math.max(0, order.remainingUsdt);
  if (remaining <= EPSILON || order.status === "filled" || order.status === "cancelled") {
    return { executableUsdt: 0, estimatedQty: 0, remainingUsdt: remaining, status: "cap_reached" };
  }
  const cap = Math.max(0, remainingCoinCapUsdt);
  if (cap <= EPSILON) return { executableUsdt: 0, estimatedQty: 0, remainingUsdt: remaining, status: "cap_reached" };
  const available = Number.isFinite(freeUsdt) ? Math.max(0, freeUsdt) : 0;
  const amount = Math.min(remaining, cap, available);
  if (amount + EPSILON < minNotionalUsdt) {
    return {
      executableUsdt: 0,
      estimatedQty: 0,
      remainingUsdt: remaining,
      status: available <= EPSILON ? "wait_balance" : "below_min_notional",
    };
  }
  return {
    executableUsdt: amount,
    estimatedQty: amount / order.referencePrice,
    remainingUsdt: Math.max(0, remaining - amount),
    status: "ready",
  };
}

export function applyConfirmedBuyFill(
  order: QueuedBuyOrder,
  quoteSpentIncludingFee: number,
  now = Date.now(),
): QueuedBuyOrder {
  if (!Number.isFinite(quoteSpentIncludingFee) || quoteSpentIncludingFee <= 0) throw new Error("成交支出必须大于 0");
  const applied = Math.min(order.remainingUsdt, quoteSpentIncludingFee);
  const remainingUsdt = Math.max(0, order.remainingUsdt - applied);
  return {
    ...order,
    filledUsdt: order.filledUsdt + applied,
    remainingUsdt,
    status: remainingUsdt <= EPSILON ? "filled" : "partially_filled",
    updatedAt: now,
    lastError: null,
  };
}

export function markOrderReconcileRequired(order: QueuedBuyOrder, reason: string, now = Date.now()): QueuedBuyOrder {
  return { ...order, status: "reconcile_required", lastError: reason, updatedAt: now };
}
