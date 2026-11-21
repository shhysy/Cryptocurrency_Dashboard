import { describe, expect, it } from "vitest";
import {
  createBinanceReconcileAdapter,
  normalizeBinanceReadOrder,
  normalizeBinanceReadTrade,
  normalizeBinanceReadBalances,
  normalizeBinanceSymbolRules,
} from "./binance-reconcile.server";

const order = {
  symbol: "BTCUSDT",
  orderId: 123,
  clientOrderId: "gpt-test-123",
  side: "BUY",
  status: "PARTIALLY_FILLED",
  origQty: "0.01000000",
  executedQty: "0.00400000",
  cummulativeQuoteQty: "250.00",
  time: 1000,
  updateTime: 2000,
};

const trade = {
  id: 9,
  orderId: 123,
  symbol: "BTCUSDT",
  isBuyer: true,
  price: "62500.00",
  qty: "0.00400000",
  quoteQty: "250.00",
  commission: "0.00000400",
  commissionAsset: "BTC",
  time: 1500,
};

describe("Binance服务端只读对账适配器", () => {
  it("严格解析订单并将未知状态映射为UNKNOWN", () => {
    expect(normalizeBinanceReadOrder(order).status).toBe("PARTIALLY_FILLED");
    expect(normalizeBinanceReadOrder({ ...order, status: "FUTURE_STATUS" }).status).toBe("UNKNOWN");
    expect(() => normalizeBinanceReadOrder({ ...order, executedQty: "NaN" })).toThrow("executedQty");
    expect(() => normalizeBinanceReadOrder({ ...order, orderId: Number.MAX_SAFE_INTEGER + 1 })).toThrow("orderId");
  });

  it("解析成交方向与手续费字段，保留精确十进制字符串", () => {
    expect(normalizeBinanceReadTrade(trade)).toMatchObject({
      side: "BUY", qty: "0.00400000", commission: "0.00000400", commissionAsset: "BTC",
    });
    expect(() => normalizeBinanceReadTrade({ ...trade, commission: "-1" })).toThrow("commission");
    expect(() => normalizeBinanceReadTrade({ ...trade, isBuyer: "true" })).toThrow("identity");
  });

  it("严格解析账户余额并拒绝重复资产或非法数字", () => {
    expect(normalizeBinanceReadBalances({ balances: [{ asset: "USDT", free: "12.50", locked: "1" }] }))
      .toEqual([{ asset: "USDT", free: "12.50", locked: "1" }]);
    expect(() => normalizeBinanceReadBalances({ balances: [
      { asset: "USDT", free: "1", locked: "0" }, { asset: "USDT", free: "2", locked: "0" },
    ] })).toThrow("重复");
    expect(() => normalizeBinanceReadBalances({ balances: [{ asset: "BTC", free: "Infinity", locked: "0" }] }))
      .toThrow("free");
  });

  it("解析交易规则并拒绝缺失交易对或非法过滤器数值", () => {
    const rules = { symbols: [{
      symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT",
      quoteOrderQtyMarketAllowed: true,
      filters: [{ filterType: "LOT_SIZE", minQty: "0.00001", maxQty: "10", stepSize: "0.00001" }],
    }] };
    expect(normalizeBinanceSymbolRules(rules, "BTCUSDT").filters[0].filterType).toBe("LOT_SIZE");
    expect(() => normalizeBinanceSymbolRules({ symbols: [] }, "BTCUSDT")).toThrow("未返回");
    expect(() => normalizeBinanceSymbolRules({ symbols: [{ ...rules.symbols[0], filters: [{ filterType: "LOT_SIZE", stepSize: "oops" }] }] }, "BTCUSDT"))
      .toThrow("stepSize");
  });

  it("按clientOrderId查单，明确区分未找到和其他错误", async () => {
    const adapter = createBinanceReconcileAdapter(async <T>() => order as T);
    await expect(adapter.findOrderByClientOrderId("BTCUSDT", "gpt-test-123"))
      .resolves.toMatchObject({ kind: "found", order: { orderId: 123, side: "BUY" } });

    const missing = createBinanceReconcileAdapter(async <T>() => {
      throw new Error('Binance 400: {"code":-2013,"msg":"Order does not exist."}');
    });
    await expect(missing.findOrderByClientOrderId("BTCUSDT", "gpt-test-123"))
      .resolves.toEqual({ kind: "not_found" });

    const throttled = createBinanceReconcileAdapter(async <T>() => {
      throw new Error('Binance 429: {"code":-1003,"msg":"Too many requests"}');
    });
    await expect(throttled.findOrderByClientOrderId("BTCUSDT", "gpt-test-123")).rejects.toThrow("429");
  });

  it("成交分页保留commission并检测不匹配订单，达到页数上限标记不完整", async () => {
    const calls: Array<Record<string, string | number>> = [];
    const adapter = createBinanceReconcileAdapter(async <T>(_path, params = {}) => {
      calls.push(params);
      return [trade] as T;
    });
    await expect(adapter.listOrderTrades("BTCUSDT", 123)).resolves.toMatchObject({
      complete: true, pagesRead: 1, trades: [{ id: 9, side: "BUY", commissionAsset: "BTC" }],
    });
    expect(calls[0]).toMatchObject({ symbol: "BTCUSDT", orderId: 123, limit: 1000 });

    const wrongOrder = createBinanceReconcileAdapter(async <T>() => [{ ...trade, orderId: 999 }] as T);
    await expect(wrongOrder.listOrderTrades("BTCUSDT", 123)).rejects.toThrow("其他交易对或订单");

    let count = 0;
    const fullPages = createBinanceReconcileAdapter(async <T>() => {
      count += 1;
      return Array.from({ length: 1000 }, (_, i) => ({ ...trade, id: (count - 1) * 1000 + i })) as T;
    });
    const result = await fullPages.listOrderTrades("BTCUSDT", 123);
    expect(result).toMatchObject({ complete: false, pagesRead: 5 });
  });
});
