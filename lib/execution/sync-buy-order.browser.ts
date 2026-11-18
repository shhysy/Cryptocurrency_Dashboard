import {
  fetchSpotOrderByClientId,
  fetchSpotTradesForOrder,
  fetchSpotSymbolFilters,
} from "../binance.browser";
import type { BinanceSpotOrderSnapshot } from "../binance.browser";
import { clientOrderIdForEvent } from "./client-order-id";
import { markOrderReconcileRequired } from "./queue";
import { decideOrderReconciliation } from "./order-reconcile";
import { reconcileConfirmedBuyFills } from "./fill-reconcile";
import { listBuyOrders, recordConfirmedBuyFill, saveBuyOrder } from "./store.browser";

export interface BuyOrderSyncResult {
  action: "wait" | "complete" | "partial" | "safe_to_retry" | "manual_review";
  newlyRecordedFills: number;
  orderStatus: string | null;
  remainingUsdt: number;
  reason: string | null;
}

/**
 * Read-only Binance reconciliation for one already-submitted buy attempt.
 * It records only exchange-confirmed fills and never submits/cancels/retries.
 */
export async function syncBuyOrderFromBinance(
  queuedOrderId: string,
  attempt: number,
): Promise<BuyOrderSyncResult> {
  const orders = await listBuyOrders();
  const initial = orders.find((item) => item.id === queuedOrderId);
  if (!initial) throw new Error("找不到待买订单");
  if (!Number.isInteger(attempt) || attempt < 0) throw new Error("订单 attempt 参数无效");

  const clientOrderId = clientOrderIdForEvent(initial.eventKey, attempt);
  let snapshot: BinanceSpotOrderSnapshot;
  try {
    snapshot = await fetchSpotOrderByClientId(initial.symbol + initial.quoteAsset, clientOrderId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "查询 Binance 订单失败";
    const blocked = markOrderReconcileRequired(initial, reason);
    await saveBuyOrder(blocked);
    return {
      action: "manual_review",
      newlyRecordedFills: 0,
      orderStatus: null,
      remainingUsdt: blocked.remainingUsdt,
      reason,
    };
  }

  const decision = decideOrderReconciliation({
    status: snapshot.status,
    executedQty: Number(snapshot.executedQty),
    cummulativeQuoteQty: Number(snapshot.cummulativeQuoteQty),
    orderId: snapshot.orderId,
  });

  if (decision.action === "wait") {
    return {
      action: "wait", newlyRecordedFills: 0, orderStatus: snapshot.status,
      remainingUsdt: initial.remainingUsdt, reason: decision.reason,
    };
  }
  if (decision.action === "manual_review") {
    const blocked = markOrderReconcileRequired(initial, decision.reason);
    await saveBuyOrder(blocked);
    return {
      action: "manual_review", newlyRecordedFills: 0, orderStatus: snapshot.status,
      remainingUsdt: blocked.remainingUsdt, reason: decision.reason,
    };
  }
  if (decision.action === "safe_to_retry") {
    // A caller may later create a new attempt after explicit policy checks; never retry here.
    return {
      action: "safe_to_retry", newlyRecordedFills: 0, orderStatus: snapshot.status,
      remainingUsdt: initial.remainingUsdt, reason: decision.reason,
    };
  }

  const [filters, trades] = await Promise.all([
    fetchSpotSymbolFilters(snapshot.symbol),
    fetchSpotTradesForOrder(snapshot.symbol, snapshot.orderId),
  ]);
  let reconciled;
  try {
    reconciled = reconcileConfirmedBuyFills({
      orderId: snapshot.orderId,
      symbol: snapshot.symbol,
      executedQty: Number(snapshot.executedQty),
      cummulativeQuoteQty: Number(snapshot.cummulativeQuoteQty),
    }, trades, filters.baseAsset, filters.quoteAsset);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "成交明细核对失败";
    const blocked = markOrderReconcileRequired(initial, reason);
    await saveBuyOrder(blocked);
    return {
      action: "manual_review", newlyRecordedFills: 0, orderStatus: snapshot.status,
      remainingUsdt: blocked.remainingUsdt, reason,
    };
  }

  if (!reconciled.complete) {
    const blocked = markOrderReconcileRequired(initial, reconciled.reason ?? "成交明细不完整");
    await saveBuyOrder(blocked);
    return {
      action: "manual_review", newlyRecordedFills: 0, orderStatus: snapshot.status,
      remainingUsdt: blocked.remainingUsdt, reason: reconciled.reason,
    };
  }

  let current = initial;
  let newlyRecordedFills = 0;
  try {
    for (const fill of reconciled.fills) {
      const saved = await recordConfirmedBuyFill(fill, current.id);
      current = saved.order;
      if (saved.recorded) newlyRecordedFills += 1;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "成交台账写入失败";
    const blocked = markOrderReconcileRequired(current, reason);
    await saveBuyOrder(blocked);
    return {
      action: "manual_review", newlyRecordedFills, orderStatus: snapshot.status,
      remainingUsdt: blocked.remainingUsdt, reason,
    };
  }

  const isCompleteOrder = snapshot.status === "FILLED";
  return {
    action: isCompleteOrder ? "complete" : "partial",
    newlyRecordedFills,
    orderStatus: snapshot.status,
    remainingUsdt: current.remainingUsdt,
    reason: null,
  };
}
