import type { BinanceSpotTrade } from "../binance.browser";
import type { ExecutionFill } from "./types";

export interface FillOrderSnapshot {
  orderId: number;
  symbol: string;
  executedQty: number;
  cummulativeQuoteQty: number;
}

export interface FillReconciliation {
  complete: boolean;
  fills: ExecutionFill[];
  quoteCommissionUsdt: number;
  reason: string | null;
}

export type BuyFillReconciliation = FillReconciliation;

const EPSILON = 1e-8;

function collectMatchingTrades(
  order: FillOrderSnapshot,
  trades: BinanceSpotTrade[],
  expectedBuyer: boolean,
): BinanceSpotTrade[] {
  const unique = new Map<string, BinanceSpotTrade>();
  for (const trade of trades) {
    if (trade.symbol !== order.symbol || trade.orderId !== order.orderId) continue;
    if (trade.isBuyer !== expectedBuyer) {
      throw new Error(expectedBuyer
        ? "买入订单成交明细出现卖出方向记录"
        : "卖出订单成交明细出现买入方向记录");
    }
    if (!Number.isSafeInteger(trade.id) || trade.id < 0 ||
        !Number.isSafeInteger(trade.orderId) || trade.orderId <= 0 ||
        !trade.symbol ||
        ![trade.price, trade.qty, trade.quoteQty, trade.commission, trade.time].every(Number.isFinite) ||
        trade.price <= 0 || trade.qty <= 0 || trade.quoteQty <= 0 ||
        trade.commission < 0 || trade.time < 0 ||
        typeof trade.commissionAsset !== "string" || !trade.commissionAsset.trim()) {
      throw new Error("成交明细数值或资产字段无效");
    }

    // Binance quoteQty should agree with price × quantity within a small
    // floating-point tolerance. A mismatch must not enter the cost ledger.
    const calculatedQuote = trade.price * trade.qty;
    const quoteTolerance = Math.max(EPSILON, Math.abs(calculatedQuote) * EPSILON);
    if (Math.abs(calculatedQuote - trade.quoteQty) > quoteTolerance) {
      throw new Error("成交明细价格、数量与成交金额不一致");
    }

    const id = String(trade.id);
    const previous = unique.get(id);
    if (previous) {
      const identical = previous.orderId === trade.orderId &&
        previous.symbol === trade.symbol &&
        previous.price === trade.price &&
        previous.qty === trade.qty &&
        previous.quoteQty === trade.quoteQty &&
        previous.commission === trade.commission &&
        previous.commissionAsset === trade.commissionAsset &&
        previous.time === trade.time &&
        previous.isBuyer === trade.isBuyer;
      if (!identical) throw new Error("同一 Binance 成交 ID 返回了冲突的成交数据");
      continue;
    }
    unique.set(id, trade);
  }
  return [...unique.values()];
}

function validateOrderTotals(order: FillOrderSnapshot): void {
  if (!order.symbol || !Number.isSafeInteger(order.orderId) || order.orderId <= 0 ||
      ![order.executedQty, order.cummulativeQuoteQty].every(Number.isFinite) ||
      order.executedQty < 0 || order.cummulativeQuoteQty < 0 ||
      ((order.executedQty === 0) !== (order.cummulativeQuoteQty === 0))) {
    throw new Error("订单累计成交数据无效");
  }
}
/**
 * Match actual BUY fills against Binance's cumulative order totals.
 * BNB/third-asset commissions are deliberately not guessed: the caller must
 * stop and request fee conversion rather than silently understate cost basis.
 */
export function reconcileConfirmedBuyFills(
  order: FillOrderSnapshot,
  trades: BinanceSpotTrade[],
  baseAsset: string,
  quoteAsset: string,
): FillReconciliation {
  validateOrderTotals(order);
  const matched = collectMatchingTrades(order, trades, true);
  const fills: ExecutionFill[] = matched.map((trade) => {
    let commissionUsdt = 0;
    if (trade.commissionAsset === quoteAsset) commissionUsdt = trade.commission;
    else if (trade.commissionAsset === baseAsset) commissionUsdt = 0;
    else if (trade.commission > 0) {
      throw new Error(`手续费资产 ${trade.commissionAsset} 无法可靠换算为 USDT，暂停自动记账`);
    }
    return {
      fillId: String(trade.id),
      orderId: String(trade.orderId),
      symbol: trade.symbol,
      side: "BUY",
      time: trade.time,
      price: trade.price,
      qty: trade.qty,
      quoteQty: trade.quoteQty,
      commission: trade.commission,
      commissionAsset: trade.commissionAsset,
      commissionUsdt,
    };
  });

  const filledQty = fills.reduce((sum, fill) => sum + fill.qty, 0);
  const filledQuote = fills.reduce((sum, fill) => sum + fill.quoteQty, 0);
  const qtyTolerance = Math.max(EPSILON, order.executedQty * EPSILON);
  const quoteTolerance = Math.max(EPSILON, order.cummulativeQuoteQty * EPSILON);
  const complete =
    Math.abs(filledQty - order.executedQty) <= qtyTolerance &&
    Math.abs(filledQuote - order.cummulativeQuoteQty) <= quoteTolerance;

  return {
    complete,
    fills,
    quoteCommissionUsdt: fills.reduce((sum, fill) => sum + fill.commissionUsdt, 0),
    reason: complete ? null : "逐笔成交与 Binance 订单累计成交量/金额不一致，暂停自动记账",
  };
}

/**
 * Match actual SELL fills against Binance's cumulative order totals.
 * Third-asset commissions remain a hard stop until their historical USDT
 * conversion can be established reliably.
 */
export function reconcileConfirmedSellFills(
  order: FillOrderSnapshot,
  trades: BinanceSpotTrade[],
  baseAsset: string,
  quoteAsset: string,
): FillReconciliation {
  validateOrderTotals(order);
  const matched = collectMatchingTrades(order, trades, false);
  const fills: ExecutionFill[] = matched.map((trade) => {
    let commissionUsdt = 0;
    if (trade.commissionAsset === quoteAsset) commissionUsdt = trade.commission;
    else if (trade.commissionAsset === baseAsset) commissionUsdt = 0;
    else if (trade.commission > 0) {
      throw new Error(`手续费资产 ${trade.commissionAsset} 无法可靠换算为 USDT，暂停自动记账`);
    }
    return {
      fillId: String(trade.id),
      orderId: String(trade.orderId),
      symbol: trade.symbol,
      side: "SELL",
      time: trade.time,
      price: trade.price,
      qty: trade.qty,
      quoteQty: trade.quoteQty,
      commission: trade.commission,
      commissionAsset: trade.commissionAsset,
      commissionUsdt,
    };
  });

  const filledQty = fills.reduce((sum, fill) => sum + fill.qty, 0);
  const filledQuote = fills.reduce((sum, fill) => sum + fill.quoteQty, 0);
  const qtyTolerance = Math.max(EPSILON, order.executedQty * EPSILON);
  const quoteTolerance = Math.max(EPSILON, order.cummulativeQuoteQty * EPSILON);
  const complete =
    Math.abs(filledQty - order.executedQty) <= qtyTolerance &&
    Math.abs(filledQuote - order.cummulativeQuoteQty) <= quoteTolerance;

  return {
    complete,
    fills,
    quoteCommissionUsdt: fills.reduce((sum, fill) => sum + fill.commissionUsdt, 0),
    reason: complete ? null : "逐笔成交与 Binance 订单累计成交量/金额不一致，暂停自动记账",
  };
}
