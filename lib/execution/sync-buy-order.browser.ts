import {
  fetchSpotOrderByClientId,
  fetchSpotTradesForOrder,
} from "../binance.browser";
import type { BinanceSpotOrderSnapshot, BinanceSpotTrade } from "../binance.browser";
import { clientOrderIdForEvent } from "./client-order-id";
import { decideOrderReconciliation } from "./order-reconcile";
import { reconcileConfirmedBuyFills, type BuyFillReconciliation } from "./fill-reconcile";
import {
  applyConfirmedBuyReservationSpend,
  listBuyOrders,
  markBuyOrderReconcileRequired,
  markBuyOrderReconciled,
  recordConfirmedBuyFill,
  releaseBuyFundsReservation,
} from "./store.browser";

export interface BuyOrderSyncResult {
  action: "wait" | "complete" | "partial" | "safe_to_retry" | "manual_review";
  newlyRecordedFills: number;
  orderStatus: string | null;
  remainingUsdt: number;
  reason: string | null;
}

/**
 * Read-only Binance reconciliation for one already-submitted buy attempt.
 * It records only exchange-confirmed fills and never submits, cancels or retries.
 */
export async function syncBuyOrderFromBinance(
  queuedOrderId: string,
  attempt: number,
): Promise<BuyOrderSyncResult> {
  const orders = await listBuyOrders();
  const initial = orders.find((item) => item.id === queuedOrderId);
  if (!initial) throw new Error("找不到待买订单");
  if (!Number.isInteger(attempt) || attempt < 0) throw new Error("订单 attempt 参数无效");

  const pair = initial.symbol.endsWith(initial.quoteAsset)
    ? initial.symbol
    : initial.symbol + initial.quoteAsset;
  const baseAsset = pair.slice(0, pair.length - initial.quoteAsset.length);
  const clientOrderId = clientOrderIdForEvent(initial.eventKey, attempt);
  let snapshot: BinanceSpotOrderSnapshot;
  try {
    snapshot = await fetchSpotOrderByClientId(pair, clientOrderId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "查询 Binance 订单失败";
    const blocked = await markBuyOrderReconcileRequired(initial.id, reason);
    return {
      action: "manual_review", newlyRecordedFills: 0, orderStatus: null,
      remainingUsdt: blocked.remainingUsdt, reason,
    };
  }

  if (snapshot.symbol !== pair) {
    const reason = "Binance 订单交易对与本地待买订单不一致";
    const blocked = await markBuyOrderReconcileRequired(initial.id, reason);
    return {
      action: "manual_review", newlyRecordedFills: 0, orderStatus: snapshot.status,
      remainingUsdt: blocked.remainingUsdt, reason,
    };
  }

  const decision = decideOrderReconciliation({
    status: snapshot.status,
    origQty: Number(snapshot.origQty),
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
    const blocked = await markBuyOrderReconcileRequired(initial.id, decision.reason);
    return {
      action: "manual_review", newlyRecordedFills: 0, orderStatus: snapshot.status,
      remainingUsdt: blocked.remainingUsdt, reason: decision.reason,
    };
  }
  if (decision.action === "safe_to_retry") {
    // Confirmed terminal zero-fill orders can leave the reconciliation hold,
    // but a separate caller must still decide whether to create a new attempt.
    await releaseBuyFundsReservation(initial.id, true, "Binance 已确认订单终态且零成交");
    const ready = await markBuyOrderReconciled(initial.id);
    return {
      action: "safe_to_retry", newlyRecordedFills: 0, orderStatus: snapshot.status,
      remainingUsdt: ready.remainingUsdt, reason: decision.reason,
    };
  }

  let trades: BinanceSpotTrade[];
  try {
    trades = await fetchSpotTradesForOrder(snapshot.symbol, snapshot.orderId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "读取成交明细失败";
    const blocked = await markBuyOrderReconcileRequired(initial.id, reason);
    return {
      action: "manual_review", newlyRecordedFills: 0, orderStatus: snapshot.status,
      remainingUsdt: blocked.remainingUsdt, reason,
    };
  }

  let reconciled: BuyFillReconciliation;
  try {
    reconciled = reconcileConfirmedBuyFills({
      orderId: snapshot.orderId,
      symbol: snapshot.symbol,
      executedQty: Number(snapshot.executedQty),
      cummulativeQuoteQty: Number(snapshot.cummulativeQuoteQty),
    }, trades, baseAsset, initial.quoteAsset);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "成交明细核对失败";
    const blocked = await markBuyOrderReconcileRequired(initial.id, reason);
    return {
      action: "manual_review", newlyRecordedFills: 0, orderStatus: snapshot.status,
      remainingUsdt: blocked.remainingUsdt, reason,
    };
  }

  if (!reconciled.complete) {
    const reason = reconciled.reason ?? "成交明细不完整";
    const blocked = await markBuyOrderReconcileRequired(initial.id, reason);
    return {
      action: "manual_review", newlyRecordedFills: 0, orderStatus: snapshot.status,
      remainingUsdt: blocked.remainingUsdt, reason,
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
    const blocked = await markBuyOrderReconcileRequired(current.id, reason);
    return {
      action: "manual_review", newlyRecordedFills, orderStatus: snapshot.status,
      remainingUsdt: blocked.remainingUsdt, reason,
    };
  }

  try {
    const cumulativeSpendUsdt = reconciled.fills.reduce(
      (sum, fill) => sum + fill.quoteQty + fill.commissionUsdt,
      0,
    );
    const terminal = ["FILLED", "CANCELED", "EXPIRED", "REJECTED"].includes(snapshot.status);
    await applyConfirmedBuyReservationSpend(
      current.id,
      cumulativeSpendUsdt,
      terminal,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "资金预留成交对账失败";
    const blocked = await markBuyOrderReconcileRequired(current.id, reason);
    return {
      action: "manual_review", newlyRecordedFills, orderStatus: snapshot.status,
      remainingUsdt: blocked.remainingUsdt, reason,
    };
  }

  const exchangeTerminal = ["FILLED", "CANCELED", "EXPIRED", "REJECTED"].includes(snapshot.status);
  if (!exchangeTerminal) {
    const held = await markBuyOrderReconcileRequired(
      current.id,
      `Binance 订单仍处于 ${snapshot.status}，已记录当前成交但禁止创建下一次 attempt；继续等待终态`,
    );
    return {
      action: snapshot.status === "PARTIALLY_FILLED" ? "partial" : "wait",
      newlyRecordedFills,
      orderStatus: snapshot.status,
      remainingUsdt: held.remainingUsdt,
      reason: "原 Binance 订单尚未终态，待买队列保持对账锁定，不能提交第二笔订单",
    };
  }

  current = await markBuyOrderReconciled(current.id);
  return {
    action: snapshot.status === "FILLED" ? "complete" : "partial",
    newlyRecordedFills,
    orderStatus: snapshot.status,
    remainingUsdt: current.remainingUsdt,
    reason: null,
  };
}
