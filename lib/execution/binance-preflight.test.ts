import { describe, expect, it } from "vitest";
import { floorToStep, parseMarketRules, preflightMarketBuy, preflightMarketSell } from "./binance-preflight";
import type { SpotSymbolFilters } from "../binance.browser";

const info: SpotSymbolFilters = {
  symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT",
  basePrecision: 8, quotePrecision: 8, quoteOrderQtyMarketAllowed: true,
  filters: [
    { filterType: "MARKET_LOT_SIZE", minQty: "0.00001", maxQty: "900", stepSize: "0.00001" },
    { filterType: "NOTIONAL", minNotional: "5", maxNotional: "100000", applyToMarket: true },
  ],
};

describe("Binance 市价单前置校验", () => {
  const rules = parseMarketRules(info);
  it("按数量步长向下取整", () => expect(floorToStep(0.001239, 0.0001)).toBe(0.0012));
  it("只允许 USDT 报价且余额不足时按余额规划", () => {
    expect(preflightMarketBuy(rules, 100, 50, 50000)).toMatchObject({ ok: true, quoteOrderQty: "50.00000000" });
  });
  it("低于最小名义金额不允许下单", () => {
    expect(preflightMarketBuy(rules, 4, 50, 50000).ok).toBe(false);
  });
  it("交易对暂停交易时不允许下单", () => {
    expect(preflightMarketBuy({ ...rules, status: "BREAK" }, 50, 50, 50000).ok).toBe(false);
  });
  it("普通止盈只能卖周期仓", () => {
    expect(preflightMarketSell({
      rules, desiredQty: 0.01, freeBaseQty: 0.1, totalPositionQty: 0.1,
      protectedBaseQty: 0.04, price: 50000,
    })).toMatchObject({ ok: true, quantity: 0.01 });
  });
  it("卖出不得超过可用余额和周期仓", () => {
    expect(preflightMarketSell({
      rules, desiredQty: 0.08, freeBaseQty: 0.05, totalPositionQty: 0.1,
      protectedBaseQty: 0.04, price: 50000,
    })).toMatchObject({ ok: true, quantity: 0.05 });
  });
  it("余额里只有底仓时拒绝普通止盈", () => {
    expect(preflightMarketSell({
      rules, desiredQty: 0.02, freeBaseQty: 0.04, totalPositionQty: 0.04,
      protectedBaseQty: 0.04, price: 50000,
    })).toMatchObject({ ok: false, quantity: 0 });
  });
});
