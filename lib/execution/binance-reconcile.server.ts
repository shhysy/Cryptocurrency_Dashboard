import { fetchSignedBinanceRead } from "../binance";

export type BinanceReadOrderStatus =
  | "NEW"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED"
  | "EXPIRED"
  | "EXPIRED_IN_MATCH"
  | "UNKNOWN";

export interface BinanceReadOrder {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  side: "BUY" | "SELL";
  status: BinanceReadOrderStatus;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  time: number;
  updateTime: number;
}

export type BinanceOrderLookup =
  | { kind: "found"; order: BinanceReadOrder }
  | { kind: "not_found" };

export interface BinanceReadTrade {
  id: number;
  orderId: number;
  symbol: string;
  side: "BUY" | "SELL";
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
}

export interface BinanceTradePageResult {
  trades: BinanceReadTrade[];
  complete: boolean;
  pagesRead: number;
}

export interface BinanceReadBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface BinanceReadSymbolRules {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  quoteOrderQtyMarketAllowed: boolean;
  filters: Array<{
    filterType: string;
    minQty?: string;
    maxQty?: string;
    stepSize?: string;
    minPrice?: string;
    maxPrice?: string;
    tickSize?: string;
    minNotional?: string;
    maxNotional?: string;
    applyToMarket?: boolean;
    applyMinToMarket?: boolean;
    applyMaxToMarket?: boolean;
  }>;
}

export type BinanceSignedRead = <T>(
  path: string,
  params?: Record<string, string | number>,
) => Promise<T>;

interface RawOrder {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  side: string;
  status: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  time: number;
  updateTime: number;
}

interface RawTrade {
  id: number;
  orderId: number;
  symbol: string;
  isBuyer: boolean;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
}

interface RawAccount {
  balances: Array<{ asset: string; free: string; locked: string }>;
}

interface RawExchangeInfo {
  symbols: Array<{
    symbol: string;
    status: string;
    baseAsset: string;
    quoteAsset: string;
    quoteOrderQtyMarketAllowed?: boolean;
    filters: BinanceReadSymbolRules["filters"];
  }>;
}

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const ASSET = /^[A-Z0-9]{2,20}$/;
const SYMBOL = /^[A-Z0-9]{5,24}$/;
const ORDER_STATUSES = new Set([
  "NEW", "PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED", "EXPIRED", "EXPIRED_IN_MATCH",
]);

function validDecimal(value: unknown, field: string, allowZero = true): string {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new Error(`Binance ${field} 字段不是有效十进制字符串`);
  }
  if (!allowZero && /^0(?:\.0+)?$/.test(value)) {
    throw new Error(`Binance ${field} 必须大于零`);
  }
  return value;
}

function validSafeInteger(value: unknown, field: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || (value as number) < (allowZero ? 0 : 1)) {
    throw new Error(`Binance ${field} 字段不是有效安全整数`);
  }
  return value as number;
}

function isOrderNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const match = error.message.match(/Binance\s+\d+\s*:\s*(\{.*\})/s);
  if (!match) return false;
  try {
    const payload = JSON.parse(match[1]) as { code?: number };
    return payload.code === -2013 || payload.code === -2011;
  } catch {
    return false;
  }
}

export function normalizeBinanceReadOrder(raw: RawOrder): BinanceReadOrder {
  if (!raw || typeof raw !== "object" || !SYMBOL.test(raw.symbol) ||
      !/^[A-Za-z0-9_-]{1,36}$/.test(raw.clientOrderId) ||
      (raw.side !== "BUY" && raw.side !== "SELL")) {
    throw new Error("Binance订单身份字段无效");
  }
  return {
    symbol: raw.symbol,
    orderId: validSafeInteger(raw.orderId, "orderId"),
    clientOrderId: raw.clientOrderId,
    side: raw.side,
    status: ORDER_STATUSES.has(raw.status) ? raw.status as BinanceReadOrderStatus : "UNKNOWN",
    origQty: validDecimal(raw.origQty, "origQty", false),
    executedQty: validDecimal(raw.executedQty, "executedQty"),
    cummulativeQuoteQty: validDecimal(raw.cummulativeQuoteQty, "cummulativeQuoteQty"),
    time: validSafeInteger(raw.time, "time", true),
    updateTime: validSafeInteger(raw.updateTime, "updateTime", true),
  };
}

export function normalizeBinanceReadTrade(raw: RawTrade): BinanceReadTrade {
  if (!raw || typeof raw !== "object" || !SYMBOL.test(raw.symbol) ||
      typeof raw.isBuyer !== "boolean" || !ASSET.test(raw.commissionAsset)) {
    throw new Error("Binance成交身份或手续费资产字段无效");
  }
  return {
    id: validSafeInteger(raw.id, "tradeId", true),
    orderId: validSafeInteger(raw.orderId, "orderId"),
    symbol: raw.symbol,
    side: raw.isBuyer ? "BUY" : "SELL",
    price: validDecimal(raw.price, "trade.price", false),
    qty: validDecimal(raw.qty, "trade.qty", false),
    quoteQty: validDecimal(raw.quoteQty, "trade.quoteQty", false),
    commission: validDecimal(raw.commission, "trade.commission"),
    commissionAsset: raw.commissionAsset,
    time: validSafeInteger(raw.time, "trade.time", true),
  };
}

export function normalizeBinanceReadBalances(raw: RawAccount): BinanceReadBalance[] {
  if (!raw || !Array.isArray(raw.balances)) throw new Error("Binance账户余额响应缺少balances");
  const seen = new Set<string>();
  return raw.balances.map((item) => {
    if (!item || !ASSET.test(item.asset) || seen.has(item.asset)) {
      throw new Error("Binance账户余额资产代码缺失或重复");
    }
    seen.add(item.asset);
    return {
      asset: item.asset,
      free: validDecimal(item.free, "balance.free"),
      locked: validDecimal(item.locked, "balance.locked"),
    };
  });
}

export function normalizeBinanceSymbolRules(raw: RawExchangeInfo, symbol: string): BinanceReadSymbolRules {
  if (!raw || !Array.isArray(raw.symbols)) throw new Error("Binance交易规则响应缺少symbols");
  const found = raw.symbols.find((item) => item.symbol === symbol);
  if (!found || !SYMBOL.test(found.symbol) || !ASSET.test(found.baseAsset) || !ASSET.test(found.quoteAsset)) {
    throw new Error("Binance未返回请求交易对的有效交易规则");
  }
  if (!Array.isArray(found.filters)) throw new Error("Binance交易规则缺少filters");
  const filters = found.filters.map((filter) => {
    if (!filter || typeof filter.filterType !== "string" || !filter.filterType) {
      throw new Error("Binance交易过滤器类型无效");
    }
    for (const key of ["minQty", "maxQty", "stepSize", "minPrice", "maxPrice", "tickSize", "minNotional", "maxNotional"] as const) {
      const value = filter[key];
      if (value !== undefined) validDecimal(value, `filter.${key}`);
    }
    return { ...filter };
  });
  return {
    symbol: found.symbol,
    status: found.status,
    baseAsset: found.baseAsset,
    quoteAsset: found.quoteAsset,
    quoteOrderQtyMarketAllowed: found.quoteOrderQtyMarketAllowed !== false,
    filters,
  };
}

/**
 * Binance Spot只读对账适配器。默认使用服务端签名客户端；测试可注入只读transport。
 * 本模块没有任何POST/下单能力。
 */
export function createBinanceReconcileAdapter(read: BinanceSignedRead = fetchSignedBinanceRead) {
  return {
    async findOrderByClientOrderId(symbol: string, clientOrderId: string): Promise<BinanceOrderLookup> {
      if (!SYMBOL.test(symbol) || !/^[A-Za-z0-9_-]{1,36}$/.test(clientOrderId)) {
        throw new Error("订单查询参数无效");
      }
      try {
        const raw = await read<RawOrder>("/api/v3/order", { symbol, origClientOrderId: clientOrderId });
        const order = normalizeBinanceReadOrder(raw);
        if (order.symbol !== symbol || order.clientOrderId !== clientOrderId) {
          throw new Error("Binance订单查询结果与请求身份不匹配");
        }
        return { kind: "found", order };
      } catch (error) {
        if (isOrderNotFound(error)) return { kind: "not_found" };
        throw error;
      }
    },

    async listOrderTrades(symbol: string, orderId: number): Promise<BinanceTradePageResult> {
      if (!SYMBOL.test(symbol)) throw new Error("成交查询交易对无效");
      validSafeInteger(orderId, "orderId");
      const trades = new Map<number, BinanceReadTrade>();
      let fromId: number | undefined;
      let pagesRead = 0;
      let complete = false;
      for (let page = 0; page < 5; page++) {
        const params: Record<string, string | number> = { symbol, orderId, limit: 1000 };
        if (fromId !== undefined) params.fromId = fromId;
        const rows = await read<RawTrade[]>("/api/v3/myTrades", params);
        if (!Array.isArray(rows)) throw new Error("Binance成交历史响应不是数组");
        pagesRead += 1;
        for (const row of rows) {
          const trade = normalizeBinanceReadTrade(row);
          if (trade.symbol !== symbol || trade.orderId !== orderId) {
            throw new Error("Binance成交历史返回了其他交易对或订单的成交");
          }
          const previous = trades.get(trade.id);
          if (previous && JSON.stringify(previous) !== JSON.stringify(trade)) {
            throw new Error("Binance成交历史包含冲突的重复tradeId");
          }
          trades.set(trade.id, trade);
        }
        if (rows.length < 1000) {
          complete = true;
          break;
        }
        const lastId = rows[rows.length - 1]?.id;
        if (!Number.isSafeInteger(lastId) || (lastId as number) < 0 ||
            (fromId !== undefined && (lastId as number) < fromId)) {
          throw new Error("Binance成交历史分页游标无效");
        }
        fromId = (lastId as number) + 1;
      }
      return {
        trades: [...trades.values()].sort((a, b) => a.id - b.id),
        complete,
        pagesRead,
      };
    },

    async getAccountBalances(): Promise<BinanceReadBalance[]> {
      const raw = await read<RawAccount>("/api/v3/account", { omitZeroBalances: "true" });
      return normalizeBinanceReadBalances(raw);
    },

    async getSymbolRules(symbol: string): Promise<BinanceReadSymbolRules> {
      if (!SYMBOL.test(symbol)) throw new Error("交易规则查询交易对无效");
      const raw = await read<RawExchangeInfo>("/api/v3/exchangeInfo", { symbol });
      return normalizeBinanceSymbolRules(raw, symbol);
    },
  };
}

export const binanceReconcileAdapter = createBinanceReconcileAdapter();
