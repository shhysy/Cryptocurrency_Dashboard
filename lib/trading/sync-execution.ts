/**
 * Read-only synchronization from Binance into the browser-local trading ledger.
 * This module never submits or cancels an order and never sends notifications.
 */
import {
  fetchSpotOrderByClientId,
  fetchSpotTradesForOrder,
} from "../binance.browser";
import type { ExecutionRecord } from "./execution-core";
import { reconcileSpotOrder } from "./reconciliation";
import {
  addTradeOnce,
  listExecutions,
  listQueuedOrders,
  saveExecution,
  saveQueuedOrder,
} from "./store";

export interface SyncExecutionResult {
  fillsComplete: boolean;
  insertedTrades: number;
  insertedTradeIds: string[];
  executionStatus: string;
  remainingQuoteUsdt: number;
  note?: string;
}

/**
 * Fetch the authoritative order + its fills, reconcile them, and persist
 * idempotently. A caller may send email only after inspecting the returned
 * confirmed fill records; this function itself intentionally sends no email.
 */
export async function syncExecutionFromBinance(
  eventKey: string,
  quoteAsset = "USDT",
): Promise<SyncExecutionResult> {
  if (!eventKey) throw new Error("缺少策略事件键");

  const [executions, queues] = await Promise.all([listExecutions(), listQueuedOrders()]);
  const stored = executions.find((item) => item.eventKey === eventKey);
  const queue = queues.find((item) => item.eventKey === eventKey);
  if (!stored) throw new Error("本地不存在该策略事件的执行记录");
  if (!queue) throw new Error("本地不存在该策略事件的待执行订单记录");

  const current: ExecutionRecord = {
    eventKey: stored.eventKey,
    clientOrderId: stored.clientOrderId,
    symbol: stored.symbol,
    side: stored.side,
    status: stored.status,
    requestedQty: stored.requestedQty,
    executedQty: stored.executedQty,
    cumulativeQuote: stored.cumulativeQuote,
    updatedAt: stored.updatedAt,
  };

  const order = await fetchSpotOrderByClientId(stored.symbol, stored.clientOrderId);
  const fills = await fetchSpotTradesForOrder(stored.symbol, order.orderId);
  const result = reconcileSpotOrder({
    current,
    order,
    trades: fills,
    plannedQuoteUsdt: queue.plannedQuoteUsdt,
    quoteAsset,
  });

  let insertedTrades = 0;
  const insertedTradeIds: string[] = [];
  for (const trade of result.trades) {
    if (await addTradeOnce(trade)) {
      insertedTrades += 1;
      insertedTradeIds.push(trade.id);
    }
  }

  await saveExecution({
    ...result.execution,
    exchangeOrderId: String(order.orderId),
  });

  if (!result.fillsComplete || result.execution.status === "reconcile-required") {
    await saveQueuedOrder({
      ...queue,
      status: "reconcile-required",
      updatedAt: Date.now(),
      lastError: result.note ?? "订单对账未完成",
    });
  } else if (queue.side === "BUY") {
    const filledQuoteUsdt = Math.min(
      queue.plannedQuoteUsdt,
      Math.max(queue.filledQuoteUsdt, queue.plannedQuoteUsdt - result.remainingQuoteUsdt),
    );
    const remainingQuoteUsdt = Math.max(0, queue.plannedQuoteUsdt - filledQuoteUsdt);
    const status = remainingQuoteUsdt <= 0.01
      ? "filled"
      : result.execution.executedQty > 0
        ? "partially-filled"
        : result.execution.status === "rejected"
          ? "blocked"
          : "queued";
    await saveQueuedOrder({
      ...queue,
      filledQuoteUsdt,
      remainingQuoteUsdt,
      status,
      updatedAt: Date.now(),
      lastError: result.execution.status === "rejected" ? "Binance 拒绝了订单，请检查原因后再处理" : undefined,
    });
  } else {
    const status = result.execution.status === "filled"
      ? "filled"
      : result.execution.executedQty > 0
        ? "partially-filled"
        : result.execution.status === "rejected"
          ? "blocked"
          : "queued";
    await saveQueuedOrder({ ...queue, status, updatedAt: Date.now() });
  }

  return {
    fillsComplete: result.fillsComplete,
    insertedTrades,
    insertedTradeIds,
    executionStatus: result.execution.status,
    remainingQuoteUsdt: result.remainingQuoteUsdt,
    ...(result.note ? { note: result.note } : {}),
  };
}
