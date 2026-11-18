/**
 * Deterministic spot-order execution primitives.
 *
 * This module deliberately does not call Binance and cannot place orders.
 * It prepares validated quantities and protects strategy events from duplicate
 * execution. A future exchange adapter must reconcile every ambiguous submit
 * before it is allowed to retry.
 */

export type OrderSide = "BUY" | "SELL";
export type ExecutionStatus =
  | "queued"
  | "submitting"
  | "partially-filled"
  | "filled"
  | "blocked"
  | "reconcile-required"
  | "cancelled"
  | "rejected";

export interface SymbolRules {
  symbol: string;
  status: string;
  stepSize: string;
  minQty: string;
  maxQty?: string;
  minNotional: string;
  quoteOrderQtyMarketAllowed?: boolean;
}

export interface PlannedOrder {
  symbol: string;
  side: OrderSide;
  quantity: number;
  quoteAmount: number;
  status: "ready" | "blocked";
  reason?: string;
}

export interface ExecutionRecord {
  eventKey: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  status: ExecutionStatus;
  requestedQty: number;
  executedQty: number;
  cumulativeQuote: number;
  updatedAt: number;
}

const EPSILON = 1e-10;

function decimals(value: string): number {
  const normalized = value.toLowerCase();
  if (normalized.includes("e-")) return Number(normalized.split("e-")[1]);
  const point = normalized.indexOf(".");
  return point < 0 ? 0 : normalized.length - point - 1;
}

function floorToStep(value: number, stepText: string): number {
  const step = Number(stepText);
  if (!Number.isFinite(value) || !Number.isFinite(step) || value <= 0 || step <= 0) return 0;
  const precision = Math.min(12, Math.max(decimals(stepText), 0));
  const units = Math.floor((value + EPSILON) / step);
  return Number((units * step).toFixed(precision));
}

/** Creates a stable idempotency key from a strategy event, not from render time. */
export function makeExecutionKey(input: {
  symbol: string;
  side: OrderSide;
  strategyEventId: string;
  tranche: string;
}): string {
  const raw = [input.symbol.toUpperCase(), input.side, input.strategyEventId, input.tranche].join("|");
  // FNV-1a 32-bit; deterministic identifier only, not a security primitive.
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `evt-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Plans a market buy using USDT free balance and the strategy's remaining
 * per-asset cost cap. It never assumes that an order was actually filled.
 */
export function planQuoteBuy(input: {
  symbol: string;
  plannedUsdt: number;
  freeUsdt: number;
  remainingAssetCapUsdt: number;
  referencePrice: number;
  rules: SymbolRules;
  minExecutableUsdt?: number;
}): PlannedOrder {
  const { symbol, rules } = input;
  const fail = (reason: string): PlannedOrder => ({
    symbol, side: "BUY", quantity: 0, quoteAmount: 0, status: "blocked", reason,
  });

  if (rules.status !== "TRADING") return fail("交易对当前不可交易");
  if (![input.plannedUsdt, input.freeUsdt, input.remainingAssetCapUsdt, input.referencePrice].every(Number.isFinite)) {
    return fail("金额或参考价格不是有效数字");
  }
  if (input.plannedUsdt <= 0 || input.freeUsdt <= 0 || input.remainingAssetCapUsdt <= 0 || input.referencePrice <= 0) {
    return fail("计划金额、可用余额、剩余额度和参考价格必须大于 0");
  }

  const quoteAmount = Math.min(input.plannedUsdt, input.freeUsdt, input.remainingAssetCapUsdt);
  const minUsdt = input.minExecutableUsdt ?? 5;
  if (quoteAmount + EPSILON < minUsdt) return fail(`可执行金额低于系统最小金额 ${minUsdt} USDT`);

  const quantity = floorToStep(quoteAmount / input.referencePrice, rules.stepSize);
  if (quantity <= 0 || quantity + EPSILON < Number(rules.minQty)) return fail("计算数量低于交易所最小数量");
  if (rules.maxQty && quantity - EPSILON > Number(rules.maxQty)) return fail("计算数量超过交易所最大数量");

  const notional = quantity * input.referencePrice;
  if (notional + EPSILON < Number(rules.minNotional)) return fail("按数量精度取整后低于交易所最小名义金额");

  return { symbol, side: "BUY", quantity, quoteAmount: notional, status: "ready" };
}

/** Protects the long-term core by limiting sells to the non-locked position. */
export function calculateSellableQty(input: {
  actualFreeQty: number;
  strategyOwnedQty: number;
  baseRatio: number;
  requestedCycleSellQty: number;
  stepSize: string;
  minQty: string;
}): { quantity: number; blocked: boolean; reason?: string } {
  const values = [input.actualFreeQty, input.strategyOwnedQty, input.baseRatio, input.requestedCycleSellQty];
  if (!values.every(Number.isFinite) || input.actualFreeQty < 0 || input.strategyOwnedQty < 0 ||
      input.baseRatio < 0 || input.baseRatio > 1 || input.requestedCycleSellQty <= 0) {
    return { quantity: 0, blocked: true, reason: "持仓或卖出参数无效" };
  }
  const unlocked = Math.max(0, input.strategyOwnedQty * (1 - input.baseRatio));
  const raw = Math.min(input.actualFreeQty, unlocked, input.requestedCycleSellQty);
  const quantity = floorToStep(raw, input.stepSize);
  if (quantity <= 0 || quantity + EPSILON < Number(input.minQty)) {
    return { quantity: 0, blocked: true, reason: "可卖周期仓不足最小交易数量，底仓保持锁定" };
  }
  return { quantity, blocked: false };
}

/** Unknown network outcomes must be reconciled; they are never safe to resubmit. */
export function nextStatusAfterSubmit(result: {
  accepted: boolean;
  definitive: boolean;
  executedQty: number;
  requestedQty: number;
}): ExecutionStatus {
  if (!result.definitive) return "reconcile-required";
  if (!result.accepted) return "rejected";
  if (result.executedQty <= 0) return "submitting";
  if (result.executedQty + EPSILON >= result.requestedQty) return "filled";
  return "partially-filled";
}

export function canSubmitAgain(status: ExecutionStatus): boolean {
  return status === "queued" || status === "blocked" || status === "cancelled" || status === "rejected";
}

export function mergeExecutionFill(
  current: ExecutionRecord,
  fill: { executedQty: number; cumulativeQuote: number; updatedAt: number },
): ExecutionRecord {
  if (![fill.executedQty, fill.cumulativeQuote, fill.updatedAt].every(Number.isFinite) ||
      fill.executedQty < current.executedQty || fill.cumulativeQuote < current.cumulativeQuote) {
    throw new Error("成交累计值无效或发生倒退");
  }
  const status: ExecutionStatus = fill.executedQty + EPSILON >= current.requestedQty
    ? "filled"
    : fill.executedQty > 0 ? "partially-filled" : current.status;
  return { ...current, executedQty: fill.executedQty, cumulativeQuote: fill.cumulativeQuote, status, updatedAt: fill.updatedAt };
}
