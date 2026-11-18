import type { BinanceSpotTrade } from "../binance.browser";
import type { ExecutionFill } from "./types";

export interface FillOrderSnapshot {
  orderId: number;
  symbol: string;
  executedQty: number;
  cummulativeQuoteQty: number;
}

export interface BuyFillReconciliation {
  complete: boolean;
  fills: ExecutionFill[];
  quoteCommissionUsdt: number;
  reason: string | null;
}

const EPSILON = 1e-8;

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
): BuyFillReconciliation {
  if (!order.symbol || !Number.isSafeInteger(order.orderId) || order.orderId <= 0 ||
      ![order.executedQty, order.cummulativeQuoteQty].every(Number.isFinite) ||
      order.executedQty < 0 || order.cummulativeQuoteQty < 0) {
    throw new Error("订单累计成交数据无效");
  }

  const unique = new Map<string, BinanceSpotTrade>();
  for (const trade of trades) {
    if (trade.symbol !== order.symbol || trade.orderId !== order.orderId) continue;
    if (!trade.isBuyer) throw new Error("买入订单成交明细出现卖出方向记录");
    if (![trade.price, trade.qty, trade.quoteQty, trade.commission, trade.time].every(Number.isFinite) ||
        trade.price <= 0 || trade.qty <= 0 || trade.quoteQty < 0 || trade.commission < 0) {
      throw new Error("成交明细数值无效");
    }
    unique.set(String(trade.id), trade);
  }

  const matched = [...unique.values()];
  const fills: ExecutionFill[] = matched.map((trade) => {
    let commissionUsdt = 0;
    if (trade.commissionAsset === quoteAsset) commissionUsdt = trade.commission;
    else if (trade.commissionAsset === baseAsset) commissionUsdt = trade.commission * trade.price;
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
