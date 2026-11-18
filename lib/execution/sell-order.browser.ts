import { preflightMarketSell, type MarketRules } from "./binance-preflight";
import type { SellEventRecord } from "./sell-store.browser";

export const LIVE_SELL_SUBMISSION_ENABLED = false as const;
export const SELL_ORDER_MODE = "DRY_RUN" as const;

export interface SellPositionSnapshot {
  /** Binance spot free balance for the base asset, excluding locked quantity. */
  freeBaseQty: number;
  /** Reconciled total position quantity from the local trade/position ledger. */
  totalPositionQty: number;
  /** Quantity protected as the long-term base under V3.3. */
  protectedBaseQty: number;
}

export interface SellDryRunResult {
  mode: typeof SELL_ORDER_MODE;
  submitted: false;
  eventKey: string;
  symbol: string;
  eventKind: string;
  requestedQty: number;
  executableQty: number;
  freeBaseQty: number;
  protectedBaseQty: number;
  remainingCycleQty: number;
  ok: boolean;
  reason: string | null;
}

/**
 * Final read-only sell preflight for a previously guarded sell event.
 * Position quantities must come from reconciled holdings; this module does
 * not infer a position from historical buys or a price-only dashboard card.
 */
export function prepareQueuedSellDryRun(input: {
  event: SellEventRecord;
  rules: MarketRules;
  position: SellPositionSnapshot;
  currentPrice: number;
}): SellDryRunResult {
  const { event, rules, position, currentPrice } = input;
  if (event.status !== "pending") {
    throw new Error(`卖出事件状态为 ${event.status}，不允许进入卖出预检`);
  }
  if (!["take_profit", "indicator_profit", "trail_stop", "base_reduce"].includes(event.kind)) {
    throw new Error("该卖出事件类型尚未纳入自动卖出预检");
  }
  if (event.symbol !== rules.symbol) {
    throw new Error("卖出事件交易对与 Binance 交易规则不一致");
  }
  const finalRequestedQty = event.kind === "base_reduce"
    ? Math.min(event.requestedQty, position.protectedBaseQty * 0.5)
    : event.requestedQty;
  const preflight = preflightMarketSell({
    rules,
    desiredQty: finalRequestedQty,
    freeBaseQty: position.freeBaseQty,
    totalPositionQty: position.totalPositionQty,
    protectedBaseQty: position.protectedBaseQty,
    price: currentPrice,
    allowBaseReduction: event.kind === "base_reduce",
  });
  const executableQty = preflight.ok ? preflight.quantity : 0;
  const rawRemainingCycleQty =
    position.totalPositionQty - position.protectedBaseQty -
    (event.kind === "base_reduce" ? 0 : executableQty);
  const remainingCycleQty = rawRemainingCycleQty <= 1e-10
    ? 0
    : Number(rawRemainingCycleQty.toFixed(12));

  return {
    mode: SELL_ORDER_MODE,
    submitted: false,
    eventKey: event.eventKey,
    symbol: event.symbol,
    eventKind: event.kind,
    requestedQty: event.requestedQty,
    executableQty,
    freeBaseQty: position.freeBaseQty,
    protectedBaseQty: position.protectedBaseQty,
    remainingCycleQty,
    ok: preflight.ok,
    reason: preflight.reason,
  };
}

/** Fail-closed guard. This phase deliberately contains no signed order POST. */
export function assertLiveSellSubmissionDisabled(): never {
  if (LIVE_SELL_SUBMISSION_ENABLED) {
    throw new Error("Live sell submission requires a separately reviewed server-side executor");
  }
  throw new Error("自动卖单尚未启用：当前仅允许 DRY_RUN 预检，不会发送 Binance 卖单请求");
}
