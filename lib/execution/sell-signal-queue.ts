import type { DashboardData } from "../types";
import { strategyConfig } from "@/strategy.config";
import { guardSellIntent, makeSellEventKey, type SellEventKind, type SellGuardState } from "./sell-guard";
import {
  listSellEvents,
  reserveSellEvent,
  type SellEventRecord,
} from "./sell-store.browser";
import { listTradeLedger } from "./store.browser";
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

export type BaseReduceLedgerFill = {
  symbol: string;
  fillId: string;
  qty: number;
  side?: string;
  sellKind?: string;
};

function baseAssetSymbol(symbol: string): string {
  const s = String(symbol || "").toUpperCase();
  return s.endsWith("USDT") ? s.slice(0, -4) : s;
}

/**
 * 从唯一成交台账按 fillId 重算底仓减仓数量。
 * - 必须 side===SELL 且 sellKind===base_reduce（字段缺失不可用）
 * - 同一 symbol+fillId 出现多行 → 冲突键，引用该键的事件整条不计
 * - 无台账 / 核验失败 → 返回 0（fail-closed）
 */
export function confirmedBaseReduceFilledQty(
  events: SellEventRecord[],
  ledgerFills?: BaseReduceLedgerFill[],
): number {
  if (!Array.isArray(ledgerFills) || ledgerFills.length === 0) {
    return 0;
  }
  const ledgerByKey = new Map<string, number>();
  const conflictKeys = new Set<string>();
  for (const fill of ledgerFills) {
    if (!fill?.symbol || !fill.fillId) continue;
    if (!Number.isFinite(fill.qty) || fill.qty <= 0) continue;
    if (fill.side !== "SELL") continue;
    if (fill.sellKind !== "base_reduce") continue;
    const key = `${baseAssetSymbol(fill.symbol)}:${String(fill.fillId).trim()}`;
    if (conflictKeys.has(key)) continue;
    if (ledgerByKey.has(key)) {
      ledgerByKey.delete(key);
      conflictKeys.add(key);
      continue;
    }
    ledgerByKey.set(key, fill.qty);
  }

  const seenFillIds = new Set<string>();
  let sum = 0;
  for (const event of events) {
    if (event.kind !== "base_reduce") continue;
    if (event.status !== "executed" && event.status !== "partially_filled") continue;
    if (!event.exchangeTerminalStatus || !isExchangeSpotOrderTerminal(event.exchangeTerminalStatus)) continue;
    const completedAt = event.fillReconcileCompletedAt;
    if (!Number.isSafeInteger(completedAt) || (completedAt as number) <= 0) continue;
    if (!Number.isFinite(event.filledQty) || (event.filledQty as number) <= 0) continue;
    if (!Array.isArray(event.fillIds) || event.fillIds.length === 0) continue;
    const normalized = event.fillIds.map((id) => String(id ?? "").trim()).filter(Boolean);
    if (normalized.length !== event.fillIds.length) continue;
    if (new Set(normalized).size !== normalized.length) continue;

    const sym = baseAssetSymbol(event.symbol);
    const keys = normalized.map((id) => `${sym}:${id}`);
    const overlap = keys.some((key) => seenFillIds.has(key));
    const allSeen = keys.every((key) => seenFillIds.has(key));
    if (allSeen) continue;
    if (overlap) continue;

    let ledgerSum = 0;
    let missing = false;
    for (const key of keys) {
      if (conflictKeys.has(key)) { missing = true; break; }
      const q = ledgerByKey.get(key);
      if (q === undefined) { missing = true; break; }
      ledgerSum += q;
    }
    if (missing) continue;
    const tol = Math.max(Number.EPSILON * 16, Math.abs(event.filledQty as number) * 1e-12);
    if (Math.abs(ledgerSum - (event.filledQty as number)) > tol) continue;

    for (const key of keys) seenFillIds.add(key);
    sum += ledgerSum;
  }
  return sum;
}

export function hasUnverifiedBaseReduceClaims(
  events: SellEventRecord[],
  ledgerFills?: BaseReduceLedgerFill[],
): boolean {
  const claimed = events.filter((event) =>
    event.kind === "base_reduce" &&
    (event.status === "executed" || event.status === "partially_filled") &&
    Number.isFinite(event.filledQty) &&
    (event.filledQty as number) > 0,
  );
  if (claimed.length === 0) return false;
  if (!Array.isArray(ledgerFills) || ledgerFills.length === 0) return true;

  for (const event of claimed) {
    const got = confirmedBaseReduceFilledQty([event], ledgerFills);
    if (!(got > 0)) return true;
  }
  return false;
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

/**
 * 跨周仍生效：任意未完结底仓减仓意图（不按 sourceWeek 过滤）。
 * pending / reconcile_required 一律占用；
 * partially_filled 若无合法终态+对账证明，视为未知，继续占用。
 */
export function hasOpenBaseReduce(events: SellEventRecord[]): boolean {
  return events.some((event) => {
    if (event.kind !== "base_reduce") return false;
    if (event.status === "pending" || event.status === "reconcile_required") return true;
    if (event.status === "partially_filled") {
      if (!event.exchangeTerminalStatus || !isExchangeSpotOrderTerminal(event.exchangeTerminalStatus)) {
        return true;
      }
      if (!Number.isSafeInteger(event.fillReconcileCompletedAt) || (event.fillReconcileCompletedAt as number) <= 0) {
        return true;
      }
      if (!Array.isArray(event.fillIds) || event.fillIds.length === 0) return true;
    }
    return false;
  });
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
  options?: { ledgerFills?: BaseReduceLedgerFill[] },
): SellSignalQueuePlan {
  const ledgerFills = options?.ledgerFills;
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

    if (hasUnverifiedBaseReduceClaims(symbolEvents, ledgerFills)) {
      blocked.push({
        symbol: coin.symbol,
        reason: "底仓减仓成交缺少可核验成交台账，已阻断本币卖出计划（人工复核）",
      });
      continue;
    }

    // 未完结底仓减仓（含跨周 pending / 未知 partial）冻结该币全部卖出
    if (hasOpenBaseReduce(symbolEvents)) {
      blocked.push({
        symbol: coin.symbol,
        reason: "该币存在未完结底仓减仓（跨周仍生效），已冻结卖出直至终态对账",
      });
      continue;
    }

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
    const baseReduceFilled = confirmedBaseReduceFilledQty(symbolEvents, ledgerFills);
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
  ledgerError?: string;
}> {
  const existingEvents = await listSellEvents();
  let ledgerFills: BaseReduceLedgerFill[] | undefined;
  let ledgerError: string | undefined;
  try {
    const ledger = await listTradeLedger();
    ledgerFills = ledger.map((row) => ({
      symbol: row.symbol,
      fillId: row.fillId,
      qty: row.qty,
      side: row.side,
      sellKind: row.sellKind,
    }));
  } catch (error) {
    ledgerFills = undefined;
    ledgerError = error instanceof Error ? error.message : "读取成交台账失败";
  }
  const plan = buildSellEventReservations(data, existingEvents, { ledgerFills });
  const blocked = [...plan.blocked];
  if (ledgerError) {
    blocked.push({ symbol: "*", reason: `成交台账读取失败：${ledgerError}` });
  }
  let created = 0;
  let existing = 0;
  for (const record of plan.records) {
    const result = await reserveSellEvent(record);
    if (result.created) created += 1;
    else existing += 1;
  }
  return { created, existing, blocked, ledgerError };
}
