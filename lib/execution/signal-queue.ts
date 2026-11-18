import type { DashboardData } from "../types";
import type { BuyOrderIntent, QueuedBuyOrder } from "./types";
import { createQueuedBuy } from "./queue";
import { enqueueBuyOrder } from "./store.browser";

const BUY_KINDS = new Set(["head", "add", "reserve"]);

/**
 * Convert only fresh, executable V3.3 BUY signals into stable weekly intents.
 * This is queue creation only: it never submits an exchange order.
 */
export function buildBuyOrderIntents(data: DashboardData): BuyOrderIntent[] {
  if (data.source !== "binance" || data.stale || !data.market.accountKnown) return [];

  const intents: BuyOrderIntent[] = [];
  for (const coin of data.coins) {
    const action = coin.signal.action;
    if (action.side !== "buy" || !BUY_KINDS.has(action.kind) || action.blocked.length > 0) continue;
    if (!Number.isFinite(action.usdt) || (action.usdt ?? 0) <= 0 ||
        !Number.isFinite(coin.price) || coin.price <= 0) continue;

    // The penultimate candle is the last completed weekly bar; current-bar
    // refreshes therefore map to the same event key and cannot enqueue duplicates.
    const sourceWeek = coin.series.length >= 2
      ? coin.series[coin.series.length - 2].t
      : coin.series[coin.series.length - 1]?.t;
    if (!Number.isFinite(sourceWeek)) continue;

    const eventKey = [coin.symbol, action.kind, action.label || "buy", String(sourceWeek)].join(":");
    intents.push({
      eventKey,
      symbol: coin.symbol,
      quoteAsset: "USDT",
      strategyLabel: action.label || action.kind,
      plannedUsdt: action.usdt as number,
      referencePrice: coin.price,
      createdAt: data.updatedAt,
      strategyVersion: "V3.3",
    });
  }
  return intents;
}

export async function enqueueEligibleBuySignals(
  data: DashboardData,
): Promise<{ created: number; existing: number; orders: QueuedBuyOrder[] }> {
  const intents = buildBuyOrderIntents(data);
  let created = 0;
  let existing = 0;
  const orders: QueuedBuyOrder[] = [];
  for (const intent of intents) {
    const result = await enqueueBuyOrder(createQueuedBuy(intent, data.updatedAt));
    if (result.created) created += 1;
    else existing += 1;
    orders.push(result.order);
  }
  return { created, existing, orders };
}
