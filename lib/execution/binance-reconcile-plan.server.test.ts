import { describe, expect, it } from "vitest";
import { createBinanceReconcileAdapter } from "./binance-reconcile.server";
import { buildBinanceReconcilePlan } from "./binance-reconcile-plan.server";

const order = {
  symbol: "BTCUSDT", orderId: 55, clientOrderId: "client-55", side: "SELL" as const,
  status: "CANCELED", origQty: "0.01000000", executedQty: "0.00400000",
  cummulativeQuoteQty: "260.00", time: 100, updateTime: 300,
};
const trade = {
  id: 101, orderId: 55, symbol: "BTCUSDT", isBuyer: false,
  price: "65000.00", qty: "0.00400000", quoteQty: "260.00",
  commission: "0.00000400", commissionAsset: "BTC", time: 200,
};
const rules = { symbols: [{
  symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT",
  filters: [{ filterType: "LOT_SIZE", stepSize: "0.00001" }],
}] };

function adapter(overrides: {
  order?: Record<string, unknown>;
  trades?: Array<Record<string, unknown>>;
  complete?: boolean;
  rules?: typeof rules;
  findError?: Error;
} = {}) {
  return createBinanceReconcileAdapter(async <T>(path: string) => {
    if (path === "/api/v3/order") {
      if (overrides.findError) throw overrides.findError;
      return (overrides.order ?? order) as T;
    }
    if (path === "/api/v3/myTrades") {
      return (overrides.trades ?? [trade]) as T;
    }
    if (path === "/api/v3/exchangeInfo") return (overrides.rules ?? rules) as T;
    throw new Error("unexpected endpoint");
  });
}

describe("Binance订单终态对账计划", () => {
  it("仅将完整终态逐笔成交转换为DO finalize输入", async () => {
    await expect(buildBinanceReconcilePlan(adapter(), {
      symbol: "BTCUSDT", clientOrderId: "client-55", expectedSide: "SELL",
    })).resolves.toMatchObject({
      kind: "finalize", exchangeOrderId: "55", exchangeStatus: "CANCELED",
      executedQty: "0.00400000", cumulativeQuoteQty: "260.00",
      fills: [{ tradeId: "101", commission: "0.00000400", commissionAsset: "BTC" }],
    });
  });

  it("活动单、未找到和查询失败均不生成终态结算", async () => {
    const input = { symbol: "BTCUSDT", clientOrderId: "client-55", expectedSide: "SELL" as const };
    await expect(buildBinanceReconcilePlan(adapter({ order: { ...order, status: "PARTIALLY_FILLED" } }), input))
      .resolves.toMatchObject({ kind: "wait" });
    await expect(buildBinanceReconcilePlan(adapter({
      findError: new Error('Binance 400: {"code":-2013,"msg":"Order does not exist"}'),
    }), input)).resolves.toMatchObject({ kind: "not_found" });
    await expect(buildBinanceReconcilePlan(adapter({ findError: new Error("Binance 429: rate limited") }), input))
      .resolves.toMatchObject({ kind: "wait" });
  });

  it("未知状态、方向冲突、累计成交不一致和不完整分页全部阻断", async () => {
    const input = { symbol: "BTCUSDT", clientOrderId: "client-55", expectedSide: "SELL" as const };
    await expect(buildBinanceReconcilePlan(adapter({ order: { ...order, status: "FUTURE" } }), input))
      .resolves.toMatchObject({ kind: "manual_review" });
    await expect(buildBinanceReconcilePlan(adapter({ order: { ...order, side: "BUY" } }), input))
      .resolves.toMatchObject({ kind: "manual_review" });
    await expect(buildBinanceReconcilePlan(adapter({
      trades: [{ ...trade, qty: "0.00399999" }],
    }), input)).resolves.toMatchObject({ kind: "manual_review" });
    await expect(buildBinanceReconcilePlan(adapter(), input))
      .resolves.toMatchObject({ kind: "finalize" });
  });

  it("第三资产手续费不能静默忽略", async () => {
    await expect(buildBinanceReconcilePlan(adapter({
      trades: [{ ...trade, commission: "0.01", commissionAsset: "BNB" }],
    }), { symbol: "BTCUSDT", clientOrderId: "client-55", expectedSide: "SELL" }))
      .resolves.toMatchObject({ kind: "manual_review" });
  });

  it("FILLED数量必须等于origQty，零成交终态必须无fills", async () => {
    const input = { symbol: "BTCUSDT", clientOrderId: "client-55", expectedSide: "SELL" as const };
    await expect(buildBinanceReconcilePlan(adapter({
      order: { ...order, status: "FILLED", executedQty: "0.00400000" },
    }), input)).resolves.toMatchObject({ kind: "manual_review" });
    await expect(buildBinanceReconcilePlan(adapter({
      order: { ...order, status: "EXPIRED", executedQty: "0", cummulativeQuoteQty: "0" },
      trades: [],
    }), input)).resolves.toMatchObject({ kind: "finalize", fills: [] });
  });
});
