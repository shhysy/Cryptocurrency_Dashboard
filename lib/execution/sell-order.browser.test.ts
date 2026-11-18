import { describe, expect, it } from "vitest";
import {
  assertLiveSellSubmissionDisabled,
  prepareQueuedSellDryRun,
  SELL_ORDER_MODE,
} from "./sell-order.browser";
import type { MarketRules } from "./binance-preflight";
import type { SellEventRecord } from "./sell-store.browser";

const rules: MarketRules = {
  symbol: "BTCUSDT",
  status: "TRADING",
  baseAsset: "BTC",
  quoteAsset: "USDT",
  stepSize: 0.001,
  minQty: 0.001,
  maxQty: 100,
  minNotional: 5,
  maxNotional: 100000,
  quotePrecision: 8,
  quoteOrderQtyMarketAllowed: true,
};

const event: SellEventRecord = {
  eventKey: "sell:BTC:take_profit:week-1",
  symbol: "BTCUSDT",
  kind: "take_profit",
  status: "pending",
  requestedQty: 0.02,
  createdAt: 1,
  updatedAt: 1,
  exchangeOrderId: null,
  fillIds: [],
  lastError: null,
};

const position = {
  freeBaseQty: 0.1,
  totalPositionQty: 0.1,
  protectedBaseQty: 0.04,
};

describe("Binance sell execution dry-run adapter", () => {
  it("allows a cycle-position sale while preserving the protected base", () => {
    expect(prepareQueuedSellDryRun({
      event, rules, position, currentPrice: 50000,
    })).toMatchObject({
      mode: SELL_ORDER_MODE,
      submitted: false,
      ok: true,
      executableQty: 0.02,
      protectedBaseQty: 0.04,
      remainingCycleQty: 0.04,
    });
  });

  it("clips requested quantity to available cycle position", () => {
    expect(prepareQueuedSellDryRun({
      event: { ...event, requestedQty: 0.08 },
      rules,
      position,
      currentPrice: 50000,
    })).toMatchObject({ ok: true, executableQty: 0.06, remainingCycleQty: 0 });
  });

  it("accepts a base-asset queue symbol and normalizes it to the Binance pair", () => {
    const result = prepareQueuedSellDryRun({
      event: { ...event, symbol: "BTC" },
      rules,
      position,
      currentPrice: 50000,
    });
    expect(result).toMatchObject({ ok: true, symbol: "BTCUSDT" });
  });

  it("blocks ordinary take-profit if only the protected base remains", () => {
    expect(prepareQueuedSellDryRun({
      event: { ...event, requestedQty: 0.02 },
      rules,
      position: { freeBaseQty: 0.04, totalPositionQty: 0.04, protectedBaseQty: 0.04 },
      currentPrice: 50000,
    })).toMatchObject({ ok: false, executableQty: 0 });
  });

  it("allows only the separately authorized base-reduction event to cross the base floor", () => {
    const result = prepareQueuedSellDryRun({
      event: { ...event, kind: "base_reduce", requestedQty: 0.04 },
      rules,
      position,
      currentPrice: 50000,
    });
    expect(result).toMatchObject({ ok: true, executableQty: 0.02 });
  });

  it("rejects stale or already-reserved sell events", () => {
    expect(() => prepareQueuedSellDryRun({
      event: { ...event, status: "reconcile_required" },
      rules, position, currentPrice: 50000,
    })).toThrow("不允许进入卖出预检");
  });

  it("fails closed for real sell submission", () => {
    expect(() => assertLiveSellSubmissionDisabled()).toThrow("自动卖单尚未启用");
  });
});
