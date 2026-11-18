import type { DashboardData } from "../types";
import { strategyConfig } from "@/strategy.config";
import { guardSellIntent, makeSellEventKey, type SellEventKind, type SellGuardState } from "./sell-guard";
import {
  listSellEvents,
  reserveSellEvent,
  type SellEventRecord,
} from "./sell-store.browser";

const KIND_MAP: Record<string, SellEventKind> = {
  takeProfit: "take_profit",
  indicatorProfit: "indicator_profit",
  trailStop: "trail_stop",
  baseReduce: "base_reduce",
};

export interface SellSignalQueuePlan {
  records: SellEventRecord[];
  blocked: { symbol: string; reason: string }[];
}

/**
 * Build stable sell-event reservations from fresh dashboard signals.
 * The reservation is an intent only; it does not submit a Binance order.
 */
export function buildSellEventReservations(
  data: DashboardData,
  existingEvents: SellEventRecord[],
): SellSignalQueuePlan {
  if (data.source !== "binance" || data.stale || !data.market.accountKnown) {
    return { records: [], blocked: [] };
  }

  const records: SellEventRecord[] = [];
  const blocked: { symbol: string; reason: string }[] = [];

  for (const coin of data.coins) {
    const action = coin.signal.action;
    const kind = KIND_MAP[action.kind];
    if (action.side !== "sell" || !kind || !Number.isFinite(action.qty) || (action.qty ?? 0) <= 0) continue;

    const sourceWeek = coin.series.length >= 2
      ? coin.series[coin.series.length - 2].t
      : coin.series[coin.series.length - 1]?.t;
    if (!Number.isFinite(sourceWeek)) continue;

    const eventKey = makeSellEventKey(coin.symbol, kind, `${sourceWeek}:${action.label || action.kind}`);
    const symbolEvents = existingEvents.filter((event) => event.symbol === coin.symbol);
    if (symbolEvents.some((event) => event.eventKey === eventKey)) continue;

    const activeEvents = symbolEvents.filter((event) =>
      event.status === "pending" || event.status === "reconcile_required" || event.status === "executed"
    );
    // A take-profit tier is a one-time event per asset; a later weekly candle
    // must not create a second reservation for the same tier.
    if (kind === "take_profit" && activeEvents.some((event) =>
      event.kind === "take_profit" && event.eventKey.endsWith(`:${action.label || action.kind}`)
    )) continue;
    const profile = strategyConfig.profiles[coin.signal.group];
    const boughtQty = coin.buys.reduce((sum, trade) => sum + trade.qty, 0);
    const baseQty = boughtQty * profile.baseRatio;
    const cycleInitialQty = Math.max(0, boughtQty - baseQty);
    const cycleReservedQty = activeEvents
      .filter((event) => event.kind !== "base_reduce")
      .reduce((sum, event) => sum + event.requestedQty, 0);
    const indicatorEvents = activeEvents.filter((event) => event.kind === "indicator_profit");
    const indicatorProfitSoldQty = indicatorEvents.reduce((sum, event) => sum + event.requestedQty, 0);
    const lastIndicatorProfitAt = indicatorEvents.length
      ? Math.max(...indicatorEvents.map((event) => event.updatedAt))
      : null;
    const baseReduceExecuted = activeEvents.some((event) => event.kind === "base_reduce");

    const state: SellGuardState = {
      executedEventKeys: symbolEvents.filter((event) => event.status === "executed").map((event) => event.eventKey),
      pendingEventKeys: symbolEvents
        .filter((event) => event.status === "pending" || event.status === "reconcile_required")
        .map((event) => event.eventKey),
      cycleInitialQty,
      indicatorProfitSoldQty,
      lastIndicatorProfitAt,
      baseReduceExecuted,
    };

    const guard = guardSellIntent({
      symbol: coin.symbol,
      kind,
      eventKey,
      desiredQty: action.qty as number,
      cycleAvailableQty: Math.max(0, Math.min(coin.qty - baseQty, cycleInitialQty - cycleReservedQty)),
      baseAvailableQty: Math.max(0, Math.min(coin.qty, baseQty)),
      now: data.updatedAt,
      allowBaseReduction: kind === "base_reduce",
    }, state);

    if (!guard.allowed) {
      blocked.push({ symbol: coin.symbol, reason: guard.reason ?? "卖出保护规则拒绝该事件" });
      continue;
    }

    records.push({
      eventKey,
      symbol: coin.symbol,
      kind,
      status: "pending",
      requestedQty: guard.qty,
      createdAt: data.updatedAt,
      updatedAt: data.updatedAt,
      exchangeOrderId: null,
      fillIds: [],
      lastError: null,
    });
  }

  return { records, blocked };
}

export async function enqueueEligibleSellSignals(data: DashboardData): Promise<{
  created: number;
  existing: number;
  blocked: { symbol: string; reason: string }[];
}> {
  const existingEvents = await listSellEvents();
  const plan = buildSellEventReservations(data, existingEvents);
  let created = 0;
  let existing = 0;
  for (const record of plan.records) {
    const result = await reserveSellEvent(record);
    if (result.created) created += 1;
    else existing += 1;
  }
  return { created, existing, blocked: plan.blocked };
}
