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
  /** 仅在明确启用 V3.3 底仓减仓规则时设置。 */
  allowBaseReduction?: boolean;
}

export interface SellGuardResult {
  allowed: boolean;
  qty: number;
  reason: string | null;
}

/** 稳定键应包含来源周线与止盈档位，不要用当前刷新时间。 */
export function makeSellEventKey(symbol: string, kind: SellEventKind, sourceEvent: string): string {
  if (!symbol || !sourceEvent) throw new Error("卖出事件缺少币种或来源标识");
  return `sell:${symbol}:${kind}:${sourceEvent}`;
}

/**
 * 防止重复卖出信号，并执行 V3.3 周期仓/底仓边界。
 * 任何网络请求前先把事件记为 pending；仅在成交确认后标记为已执行。
 */
export function guardSellIntent(request: SellGuardRequest, state: SellGuardState): SellGuardResult {
  if (!request.eventKey || !Number.isFinite(request.desiredQty) || request.desiredQty <= 0) {
    return { allowed: false, qty: 0, reason: "卖出事件或数量无效" };
  }
  if (state.executedEventKeys.includes(request.eventKey) || state.pendingEventKeys.includes(request.eventKey)) {
    return { allowed: false, qty: 0, reason: "该卖出事件已执行或正在处理中，禁止重复提交" };
  }
  if (request.kind === "base_reduce") {
    // 必须显式授权；undefined/false 一律拒绝，禁止落到周期仓数量上误放行。
    if (request.allowBaseReduction !== true) {
      return { allowed: false, qty: 0, reason: "底仓减仓未显式授权，已拒绝" };
    }
    if (state.baseReduceExecuted) {
      return { allowed: false, qty: 0, reason: "底仓减仓事件已执行，禁止重复减仓" };
    }
  }
  let available = Math.max(0, request.cycleAvailableQty);
  if (request.kind === "base_reduce" && request.allowBaseReduction === true) {
    // V3.3 底仓减仓：单次最多卖出剩余受保护底仓的 50%。
    available = Math.max(0, request.baseAvailableQty * 0.5);
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
