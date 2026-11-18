export type SellEventKind = "take_profit" | "indicator_profit" | "trail_stop" | "base_reduce" | "fundamental_exit";

export interface SellGuardState {
  executedEventKeys: string[];
  pendingEventKeys: string[];
  cycleInitialQty: number;
  indicatorProfitSoldQty: number;
  lastIndicatorProfitAt: number | null;
  baseReduceExecuted: boolean;
}

export interface SellGuardRequest {
  symbol: string;
  kind: SellEventKind;
  eventKey: string;
  desiredQty: number;
  cycleAvailableQty: number;
  baseAvailableQty: number;
  now: number;
  /** Set only for the explicit V3.3 base-reduction rule. */
  allowBaseReduction?: boolean;
}

export interface SellGuardResult {
  allowed: boolean;
  qty: number;
  reason: string | null;
}

/** Stable key should include the source weekly candle and TP tier, not the current refresh time. */
export function makeSellEventKey(symbol: string, kind: SellEventKind, sourceEvent: string): string {
  if (!symbol || !sourceEvent) throw new Error("卖出事件缺少币种或来源标识");
  return `sell:${symbol}:${kind}:${sourceEvent}`;
}

/**
 * Prevents duplicate sell signals and enforces V3.3 cycle/base boundaries.
 * Persist the event as pending before any network request; mark it executed only after confirmed fills.
 */
export function guardSellIntent(request: SellGuardRequest, state: SellGuardState): SellGuardResult {
  if (!request.eventKey || !Number.isFinite(request.desiredQty) || request.desiredQty <= 0) {
    return { allowed: false, qty: 0, reason: "卖出事件或数量无效" };
  }
  if (state.executedEventKeys.includes(request.eventKey) || state.pendingEventKeys.includes(request.eventKey)) {
    return { allowed: false, qty: 0, reason: "该卖出事件已执行或正在处理中，禁止重复提交" };
  }
  if (request.kind === "base_reduce" && state.baseReduceExecuted) {
    return { allowed: false, qty: 0, reason: "底仓减仓事件已执行，禁止重复减仓" };
  }
  let available = Math.max(0, request.cycleAvailableQty);
  if (request.kind === "base_reduce" && request.allowBaseReduction) {
    available = Math.max(0, request.baseAvailableQty);
  }
  let qty = Math.min(request.desiredQty, available);
  if (request.kind === "indicator_profit") {
    const cooldownMs = 14 * 24 * 60 * 60 * 1000;
    if (state.lastIndicatorProfitAt !== null && request.now - state.lastIndicatorProfitAt < cooldownMs) {
      return { allowed: false, qty: 0, reason: "指标止盈距离上次执行不足 2 周" };
    }
    const cap = Math.max(0, state.cycleInitialQty * 0.5 - state.indicatorProfitSoldQty);
    qty = Math.min(qty, cap);
    if (qty <= 0) return { allowed: false, qty: 0, reason: "指标止盈累计已达到周期仓 50% 上限" };
  }
  if (qty <= 0) return { allowed: false, qty: 0, reason: "没有可卖出的对应仓位" };
  return { allowed: true, qty, reason: null };
}
