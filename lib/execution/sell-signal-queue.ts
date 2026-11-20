import type { DashboardData } from "../types";
import { strategyConfig } from "@/strategy.config";
import { guardSellIntent, makeSellEventKey, type SellEventKind, type SellGuardState } from "./sell-guard";
import {
  listSellEvents,
  reserveSellEvent,
  type SellEventRecord,
} from "./sell-store.browser";
import {
  isExchangeSpotOrderTerminal,
  localEventEligibleForTakeProfitResume,
} from "./sell-order-status";

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
 * 仅统计具备终态+对账证明的底仓减仓成交。
 * - 终态必须通过 isExchangeSpotOrderTerminal（拒绝 NEW/PARTIALLY_FILLED/未知）
 * - 按 symbol+fillId 去重；若 fillIds 与已计入事件部分重叠，整条跳过（禁止部分去重却全额累加）
 * - 旧 IndexedDB 无证明的记录不减少受保护底仓
 */
export function confirmedBaseReduceFilledQty(events: SellEventRecord[]): number {
  const seenFillIds = new Set<string>();
  let sum = 0;
  for (const event of events) {
    if (event.kind !== "base_reduce") continue;
    if (event.status !== "executed" && event.status !== "partially_filled") continue;
    if (!event.exchangeTerminalStatus || !isExchangeSpotOrderTerminal(event.exchangeTerminalStatus)) continue;
    if (!Number.isFinite(event.fillReconcileCompletedAt) || (event.fillReconcileCompletedAt as number) <= 0) continue;
    if (!Number.isFinite(event.filledQty) || (event.filledQty as number) <= 0) continue;
    if (!Array.isArray(event.fillIds) || event.fillIds.length === 0) continue;

    const keys = event.fillIds.map((id) => `${event.symbol}:${id}`);
    const overlap = keys.some((key) => seenFillIds.has(key));
    const allSeen = keys.every((key) => seenFillIds.has(key));
    if (allSeen) continue;
    if (overlap) continue;

    for (const key of keys) seenFillIds.add(key);
    sum += event.filledQty as number;
  }
  return sum;
}

export function protectedBaseQtyAfterReductions(
  boughtQty: number,
  baseRatio: number,
  baseReduceFilledQty: number,
): number {
  if (!Number.isFinite(boughtQty) || boughtQty <= 0) return 0;
  if (!Number.isFinite(baseRatio) || baseRatio <= 0) return 0;
  const nominal = boughtQty * baseRatio;
  const reduced = Number.isFinite(baseReduceFilledQty) ? Math.max(0, baseReduceFilledQty) : 0;
  return Math.max(0, nominal - reduced);
}

function tierSuffix(label: string | undefined, kind: string): string {
  return `:${label || kind}`;
}

export function takeProfitTierHasOpenWork(events: SellEventRecord[], suffix: string): boolean {
  return events.some((event) =>
    event.kind === "take_profit" &&
    event.eventKey.includes(suffix) &&
    (event.status === "pending" || event.status === "reconcile_required"),
  );
}

export function hasOpenBaseReduce(events: SellEventRecord[]): boolean {
  return events.some((event) =>
    event.kind === "base_reduce" &&
    (event.status === "pending" || event.status === "reconcile_required"),
  );
}

export function isTerminalReconciledPartial(
  event: Pick<SellEventRecord, "status" | "filledQty" | "requestedQty" | "fillIds" | "exchangeOrderId" | "exchangeTerminalStatus" | "fillReconcileCompletedAt" | "lotStepSize">,
): boolean {
  return localEventEligibleForTakeProfitResume(event);
}

export function takeProfitTierFullyFilled(events: SellEventRecord[], suffix: string): boolean {
  const tierEvents = events.filter((event) =>
    event.kind === "take_profit" && event.eventKey.includes(suffix),
  );
  if (tierEvents.length === 0) return false;
  const filled = tierEvents
    .filter((event) => event.status === "executed" || event.status === "partially_filled")
    .reduce((sum, event) => {
      if (Number.isFinite(event.filledQty) && (event.filledQty as number) > 0) {
        return sum + (event.filledQty as number);
      }
      if (event.status === "executed" && Number.isFinite(event.requestedQty)) {
        return sum + event.requestedQty;
      }
      return sum;
    }, 0);
  const target = Math.max(
    0,
    ...tierEvents.map((event) => (Number.isFinite(event.requestedQty) ? event.requestedQty : 0)),
  );
  if (target <= 0) return tierEvents.some((event) => event.status === "executed");
  return filled + 1e-12 >= target;
}

export function takeProfitTierFilledQty(events: SellEventRecord[], suffix: string): number {
  return events
    .filter((event) =>
      event.kind === "take_profit" &&
      event.eventKey.includes(suffix) &&
      (event.status === "executed" || event.status === "partially_filled") &&
      Number.isFinite(event.filledQty),
    )
    .reduce((sum, event) => sum + (event.filledQty as number), 0);
}

export function takeProfitTierCanResume(events: SellEventRecord[], suffix: string): boolean {
  if (takeProfitTierHasOpenWork(events, suffix)) return false;
  if (takeProfitTierFullyFilled(events, suffix)) return false;
  return events.some((event) =>
    event.kind === "take_profit" &&
    event.eventKey.includes(suffix) &&
    isTerminalReconciledPartial(event),
  );
}

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

    const suffix = tierSuffix(action.label, action.kind);
    let eventKey = makeSellEventKey(coin.symbol, kind, `${sourceWeek}:${action.label || action.kind}`);
    const symbolEvents = existingEvents.filter((event) => event.symbol === coin.symbol);

    const activeOpen = symbolEvents.filter((event) =>
      event.status === "pending" || event.status === "reconcile_required",
    );

    if (kind === "base_reduce") {
      if (hasOpenBaseReduce(symbolEvents)) {
        blocked.push({ symbol: coin.symbol, reason: "该币已有进行中的底仓减仓（含跨周），禁止重复创建" });
        continue;
      }
      if (symbolEvents.some((event) => event.eventKey === eventKey)) continue;
    } else if (kind === "take_profit") {
      if (takeProfitTierHasOpenWork(symbolEvents, suffix)) {
        blocked.push({ symbol: coin.symbol, reason: "该止盈档仍有待处理或待对账订单，禁止重复提交" });
        continue;
      }
      if (takeProfitTierFullyFilled(symbolEvents, suffix)) continue;

      const alreadyFilled = takeProfitTierFilledQty(symbolEvents, suffix);
      if (alreadyFilled > 0) {
        if (!takeProfitTierCanResume(symbolEvents, suffix)) {
          blocked.push({
            symbol: coin.symbol,
            reason: "止盈档已有成交记录但未满足终态对账条件，禁止续卖",
          });
          continue;
        }
        eventKey = makeSellEventKey(
          coin.symbol,
          kind,
          `${sourceWeek}:${action.label || action.kind}:resume:${alreadyFilled}`,
        );
        if (symbolEvents.some((event) => event.eventKey === eventKey)) continue;
      } else if (symbolEvents.some((event) => event.eventKey === eventKey)) {
        continue;
      }
    } else if (symbolEvents.some((event) => event.eventKey === eventKey)) {
      continue;
    }

    const profile = strategyConfig.profiles[coin.signal.group];
    const boughtQty = coin.buys.reduce((sum, trade) => sum + trade.qty, 0);
    const baseReduceFilled = confirmedBaseReduceFilledQty(symbolEvents);
    const baseQty = protectedBaseQtyAfterReductions(boughtQty, profile.baseRatio, baseReduceFilled);
    const nominalBase = boughtQty * profile.baseRatio;
    const cycleInitialQty = Math.max(0, boughtQty - nominalBase);
    const cycleReservedQty = activeOpen
      .filter((event) => event.kind !== "base_reduce")
      .reduce((sum, event) => sum + event.requestedQty, 0);
    const indicatorEvents = symbolEvents.filter((event) => event.kind === "indicator_profit");
    const indicatorProfitSoldQty = indicatorEvents.reduce((sum, event) => sum + (
      event.status === "pending" || event.status === "reconcile_required"
        ? event.requestedQty
        : (Number.isFinite(event.filledQty) ? (event.filledQty as number) : 0)
    ), 0);
    const lastIndicatorProfitAt = indicatorEvents.length
      ? Math.max(...indicatorEvents.map((event) => event.updatedAt))
      : null;
    const baseReduceExecuted = baseReduceFilled > 0 || symbolEvents.some((event) =>
      event.kind === "base_reduce" && event.status === "executed",
    );

    const state: SellGuardState = {
      executedEventKeys: symbolEvents
        .filter((event) => event.status === "executed" || event.status === "partially_filled")
        .map((event) => event.eventKey),
      pendingEventKeys: symbolEvents
        .filter((event) => event.status === "pending" || event.status === "reconcile_required")
        .map((event) => event.eventKey),
      cycleInitialQty,
      indicatorProfitSoldQty,
      lastIndicatorProfitAt,
      baseReduceExecuted,
    };

    let desiredQty = action.qty as number;
    if (kind === "take_profit") {
      const alreadyFilled = takeProfitTierFilledQty(symbolEvents, suffix);
      if (alreadyFilled > 0) desiredQty = Math.max(0, desiredQty - alreadyFilled);
    }
    if (desiredQty <= 0) continue;

    const cycleAvailableQty = Math.max(
      0,
      Math.min(coin.qty - baseQty, cycleInitialQty - cycleReservedQty),
    );

    const guard = guardSellIntent({
      symbol: coin.symbol,
      kind,
      eventKey,
      desiredQty,
      cycleAvailableQty,
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
