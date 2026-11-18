import {
  fetchSpotOrderById,
  fetchSpotTradesForOrder,
} from "../binance.browser";
import { decideOrderReconciliation } from "./order-reconcile";
import { reconcileConfirmedSellFills } from "./fill-reconcile";
import { recordConfirmedSellFill } from "./store.browser";
import {
  listSellEvents,
  updateSellEvent,
  type SellEventRecord,
} from "./sell-store.browser";

export interface SellOrderSyncResult {
  action: "wait" | "partial" | "complete" | "manual_review";
  newlyRecordedFills: number;
  orderStatus: string | null;
  reason: string | null;
}

/**
 * Read-only reconciliation for a SELL order whose exchange order ID has
 * already been bound to a reserved sell event. This function never submits,
 * cancels, or retries an order.
 */
export async function syncSellOrderFromBinance(
  eventKey: string,
  quoteAsset = "USDT",
): Promise<SellOrderSyncResult> {
  if (!eventKey) throw new Error("卖出事件 ID 不能为空");
  if (!/^[A-Z0-9]{2,20}$/.test(quoteAsset)) throw new Error("报价资产格式无效");

  const events = await listSellEvents();
  const event = events.find((item) => item.eventKey === eventKey);
  if (!event) throw new Error("找不到待对账卖出事件");
  if (event.status !== "pending" && event.status !== "reconcile_required") {
    throw new Error(`卖出事件状态为 ${event.status}，不允许对账`);
  }
  if (!event.exchangeOrderId || !/^[0-9]{1,32}$/.test(event.exchangeOrderId)) {
    return {
      action: "manual_review",
      newlyRecordedFills: 0,
      orderStatus: null,
      reason: "卖出事件尚未绑定 Binance 订单 ID；当前没有卖单提交器，不能猜测订单",
    };
  }

  const pair = event.symbol.endsWith(quoteAsset) ? event.symbol : event.symbol + quoteAsset;
  const baseAsset = pair.slice(0, pair.length - quoteAsset.length);
  const numericOrderId = Number(event.exchangeOrderId);
  if (!Number.isSafeInteger(numericOrderId) || numericOrderId <= 0) {
    return {
      action: "manual_review", newlyRecordedFills: 0, orderStatus: null,
      reason: "本地绑定的 Binance 订单 ID 无效",
    };
  }

  let snapshot;
  try {
    snapshot = await fetchSpotOrderById(pair, numericOrderId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "查询 Binance 卖出订单失败";
    await updateSellEvent({ ...event, status: "reconcile_required", lastError: reason, updatedAt: Date.now() });
    return { action: "manual_review", newlyRecordedFills: 0, orderStatus: null, reason };
  }

  if (snapshot.symbol !== pair || String(snapshot.orderId) !== event.exchangeOrderId) {
    const reason = "Binance 返回的交易对或订单 ID 与本地卖出事件不一致";
    await updateSellEvent({ ...event, status: "reconcile_required", lastError: reason, updatedAt: Date.now() });
    return { action: "manual_review", newlyRecordedFills: 0, orderStatus: snapshot.status, reason };
  }

  const decision = decideOrderReconciliation({
    status: snapshot.status,
    origQty: Number(snapshot.origQty),
    executedQty: Number(snapshot.executedQty),
    cummulativeQuoteQty: Number(snapshot.cummulativeQuoteQty),
    orderId: snapshot.orderId,
  });

  if (decision.action === "wait") {
    return { action: "wait", newlyRecordedFills: 0, orderStatus: snapshot.status, reason: decision.reason };
  }
  if (decision.action === "manual_review" || decision.action === "safe_to_retry") {
    const reason = decision.reason;
    await updateSellEvent({ ...event, status: "blocked", lastError: reason, updatedAt: Date.now() });
    return { action: "manual_review", newlyRecordedFills: 0, orderStatus: snapshot.status, reason };
  }

  let trades;
  try {
    trades = await fetchSpotTradesForOrder(pair, snapshot.orderId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "读取 Binance 卖出成交明细失败";
    await updateSellEvent({ ...event, status: "reconcile_required", lastError: reason, updatedAt: Date.now() });
    return { action: "manual_review", newlyRecordedFills: 0, orderStatus: snapshot.status, reason };
  }

  let reconciled;
  try {
    reconciled = reconcileConfirmedSellFills({
      orderId: snapshot.orderId,
      symbol: snapshot.symbol,
      executedQty: Number(snapshot.executedQty),
      cummulativeQuoteQty: Number(snapshot.cummulativeQuoteQty),
    }, trades, baseAsset, quoteAsset);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "卖出成交核对失败";
    await updateSellEvent({ ...event, status: "reconcile_required", lastError: reason, updatedAt: Date.now() });
    return { action: "manual_review", newlyRecordedFills: 0, orderStatus: snapshot.status, reason };
  }

  if (!reconciled.complete) {
    const reason = reconciled.reason ?? "卖出逐笔成交与订单累计数据不一致";
    await updateSellEvent({ ...event, status: "reconcile_required", lastError: reason, updatedAt: Date.now() });
    return { action: "manual_review", newlyRecordedFills: 0, orderStatus: snapshot.status, reason };
  }

  let newlyRecordedFills = 0;
  try {
    for (const fill of reconciled.fills) {
      const saved = await recordConfirmedSellFill(fill, event.kind as NonNullable<import("./types").TradeLedgerEntry["sellKind"]>);
      if (saved.recorded) newlyRecordedFills += 1;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "卖出成交台账写入失败";
    await updateSellEvent({ ...event, status: "reconcile_required", lastError: reason, updatedAt: Date.now() });
    return { action: "manual_review", newlyRecordedFills, orderStatus: snapshot.status, reason };
  }

  const fillIds = [...new Set([...event.fillIds, ...reconciled.fills.map((fill) => fill.fillId)])];
  const terminal = snapshot.status === "FILLED" || snapshot.status === "CANCELED" ||
    snapshot.status === "EXPIRED" || snapshot.status === "REJECTED";
  const nextEvent: SellEventRecord = {
    ...event,
    status: terminal
      ? (Number(snapshot.executedQty) + 1e-8 < Number(snapshot.origQty) ? "partially_filled" : "executed")
      : "reconcile_required",
    fillIds,
    filledQty: Number(snapshot.executedQty),
    lastError: terminal ? null : "卖出订单仍未进入终态；已记录当前确认成交，继续只读对账",
    updatedAt: Date.now(),
  };
  await updateSellEvent(nextEvent);

  return {
    action: terminal ? "complete" : "partial",
    newlyRecordedFills,
    orderStatus: snapshot.status,
    reason: nextEvent.lastError,
  };
}
