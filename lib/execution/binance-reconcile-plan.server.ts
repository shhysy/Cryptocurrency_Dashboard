import type { ExecutionFill } from "./types";
import type {
  BinanceOrderLookup,
  BinanceReadOrder,
  BinanceReadTrade,
  BinanceReadSymbolRules,
  createBinanceReconcileAdapter,
} from "./binance-reconcile.server";

type ReconcileAdapter = ReturnType<typeof createBinanceReconcileAdapter>;

export type BinanceReconcilePlan =
  | { kind: "not_found"; reason: string }
  | { kind: "wait"; reason: string }
  | { kind: "open_fills"; exchangeOrderId: string; status: "NEW" | "PARTIALLY_FILLED"; fills: Array<{
      tradeId: string; orderId: string; symbol: string; price: string; qty: string; quoteQty: string;
      commission: string; commissionUsdt: string; commissionAsset: string; filledAt: number;
    }> }
  | { kind: "manual_review"; reason: string }
  | {
      kind: "finalize";
      exchangeOrderId: string;
      exchangeStatus: "FILLED" | "CANCELED" | "EXPIRED" | "EXPIRED_IN_MATCH" | "REJECTED";
      executedQty: string;
      cumulativeQuoteQty: string;
      exchangeTerminalAt: number;
      fills: Array<{
        tradeId: string;
        orderId: string;
        price: string;
        qty: string;
        quoteQty: string;
        commission: string;
        commissionAsset: string;
        filledAt: number;
      }>;
    };

interface DecimalParts {
  units: bigint;
  scale: number;
}

function parseDecimal(value: string): DecimalParts {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error("Binance对账数据包含无效十进制数字");
  }
  const [whole, fraction = ""] = value.split(".");
  return { units: BigInt(whole + fraction), scale: fraction.length };
}

function sumDecimalStrings(values: string[]): string {
  const parsed = values.map(parseDecimal);
  const scale = Math.max(0, ...parsed.map((item) => item.scale));
  const sum = parsed.reduce(
    (total, item) => total + item.units * 10n ** BigInt(scale - item.scale),
    0n,
  );
  const factor = 10n ** BigInt(scale);
  const whole = sum / factor;
  const fraction = scale > 0
    ? (sum % factor).toString().padStart(scale, "0").replace(/0+$/, "")
    : "";
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function decimalsEqual(left: string, right: string): boolean {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const scale = Math.max(a.scale, b.scale);
  return a.units * 10n ** BigInt(scale - a.scale) ===
    b.units * 10n ** BigInt(scale - b.scale);
}

function isZero(value: string): boolean {
  return decimalsEqual(value, "0");
}

const TERMINAL = new Set(["FILLED", "CANCELED", "EXPIRED", "EXPIRED_IN_MATCH", "REJECTED"]);

function validateOrderSnapshot(order: BinanceReadOrder): string | null {
  try {
    const original = parseDecimal(order.origQty);
    const executed = parseDecimal(order.executedQty);
    const quote = parseDecimal(order.cummulativeQuoteQty);
    const scale = Math.max(original.scale, executed.scale);
    if (executed.units * 10n ** BigInt(scale - executed.scale) >
        original.units * 10n ** BigInt(scale - original.scale)) {
      return "订单累计成交数量超过原始委托数量";
    }
    if (isZero(order.executedQty) !== isZero(order.cummulativeQuoteQty)) {
      return "订单累计成交数量与成交金额同时为零的关系不一致";
    }
    if (order.updateTime <= 0) return "交易所订单更新时间无效";
    if (quote.units < 0n) return "订单累计成交金额无效";
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "订单累计字段无效";
  }
}

/**
 * 只把交易所终态 + 完整逐笔成交证明转换为DO finalize输入。
 * 任何未完成分页、身份冲突、手续费资产未知或累计量不一致都不会释放reservation。
 */
export async function buildBinanceReconcilePlan(
  adapter: ReconcileAdapter,
  input: { symbol: string; clientOrderId: string; expectedSide: "BUY" | "SELL" },
): Promise<BinanceReconcilePlan> {
  let lookup: BinanceOrderLookup;
  try {
    lookup = await adapter.findOrderByClientOrderId(input.symbol, input.clientOrderId);
  } catch (error) {
    return {
      kind: "wait",
      reason: error instanceof Error ? error.message : "Binance订单查询失败，保留资金预留",
    };
  }
  if (lookup.kind === "not_found") {
    return { kind: "not_found", reason: "按原clientOrderId暂未查到订单；保留资金预留，禁止重发" };
  }

  const order = lookup.order;
  if (order.symbol !== input.symbol || order.clientOrderId !== input.clientOrderId ||
      order.side !== input.expectedSide) {
    return { kind: "manual_review", reason: "交易所订单身份/方向与本地订单意图不匹配" };
  }
  const invalid = validateOrderSnapshot(order);
  if (invalid) return { kind: "manual_review", reason: invalid };

  if (order.status === "UNKNOWN") {
    return { kind: "manual_review", reason: "交易所返回未知订单状态，禁止自动终态结算" };
  }
  if (order.status === "FILLED" && !decimalsEqual(order.origQty, order.executedQty)) {
    return { kind: "manual_review", reason: "FILLED订单累计成交数量与原始委托数量不一致" };
  }

  let tradesResult;
  let rules: BinanceReadSymbolRules;
  try {
    [tradesResult, rules] = await Promise.all([
      adapter.listOrderTrades(input.symbol, order.orderId),
      adapter.getSymbolRules(input.symbol),
    ]);
  } catch (error) {
    return {
      kind: "wait",
      reason: error instanceof Error ? error.message : "读取逐笔成交或交易规则失败，保留资金预留",
    };
  }
  if (!tradesResult.complete) {
    return { kind: "wait", reason: "逐笔成交分页未完整读取，禁止终态结算" };
  }
  if (!rules.baseAsset || !rules.quoteAsset) {
    return { kind: "manual_review", reason: "交易对base/quote资产信息缺失" };
  }

  const trades: BinanceReadTrade[] = tradesResult.trades;
  for (const trade of trades) {
    if (trade.symbol !== input.symbol || trade.orderId !== order.orderId ||
        trade.side !== order.side || trade.time > order.updateTime) {
      return { kind: "manual_review", reason: "逐笔成交订单归属、方向或时间与订单终态不匹配" };
    }
    if (!isZero(trade.commission) &&
        trade.commissionAsset !== rules.baseAsset &&
        trade.commissionAsset !== rules.quoteAsset) {
      return {
        kind: "manual_review",
        reason: `手续费资产${trade.commissionAsset}不是交易对base/quote资产，需先完成历史换算`,
      };
    }
  }

  let summedQty: string;
  let summedQuote: string;
  try {
    summedQty = sumDecimalStrings(trades.map((trade) => trade.qty));
    summedQuote = sumDecimalStrings(trades.map((trade) => trade.quoteQty));
  } catch (error) {
    return { kind: "manual_review", reason: error instanceof Error ? error.message : "逐笔成交数量累计失败" };
  }
  if (!decimalsEqual(summedQty, order.executedQty) ||
      !decimalsEqual(summedQuote, order.cummulativeQuoteQty) ||
      ((isZero(order.executedQty)) !== (trades.length === 0)) ||
      (order.status === "FILLED" && trades.length === 0)) {
    return { kind: "manual_review", reason: "逐笔成交数量/金额与交易所订单累计值不一致，禁止释放资金" };
  }

  if (!TERMINAL.has(order.status)) {
    const fills = trades.map((trade) => ({
      tradeId: String(trade.id),
      orderId: String(trade.orderId),
      symbol: trade.symbol,
      price: trade.price,
      qty: trade.qty,
      quoteQty: trade.quoteQty,
      commission: trade.commission,
      commissionUsdt: trade.commissionAsset === rules.quoteAsset ? trade.commission : "0",
      commissionAsset: trade.commissionAsset,
      filledAt: trade.time,
    }));
    return {
      kind: "open_fills",
      exchangeOrderId: String(order.orderId),
      status: order.status as "NEW" | "PARTIALLY_FILLED",
      fills,
    };
  }

  return {
    kind: "finalize",
    exchangeOrderId: String(order.orderId),
    exchangeStatus: order.status as "FILLED" | "CANCELED" | "EXPIRED" | "EXPIRED_IN_MATCH" | "REJECTED",
    executedQty: order.executedQty,
    cumulativeQuoteQty: order.cummulativeQuoteQty,
    exchangeTerminalAt: order.updateTime,
    fills: trades.map((trade) => ({
      tradeId: String(trade.id),
      orderId: String(trade.orderId),
      price: trade.price,
      qty: trade.qty,
      quoteQty: trade.quoteQty,
      commission: trade.commission,
      commissionAsset: trade.commissionAsset,
      filledAt: trade.time,
    })),
  };
}
