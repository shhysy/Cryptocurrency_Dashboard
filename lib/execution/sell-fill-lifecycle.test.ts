import { describe, expect, it } from "vitest";
import { reconcileConfirmedSellFills } from "./fill-reconcile";
import { replayPositionLedger } from "./position-accounting";
import type { BinanceSpotTrade } from "../binance.browser";
import type { ExecutionFill } from "./types";

const buyFill: ExecutionFill & { baseRatioAtBuy: number } = {
  fillId: "1",
  orderId: "10",
  symbol: "BTCUSDT",
  side: "BUY",
  time: 1000,
  price: 10000,
  qty: 0.01,
  quoteQty: 100,
  commission: 0,
  commissionAsset: "USDT",
  commissionUsdt: 0,
  baseRatioAtBuy: 0.5,
};

const sellTrades: BinanceSpotTrade[] = [
  {
    id: 101, orderId: 20, symbol: "BTCUSDT", price: 12000, qty: 0.002,
    quoteQty: 24, commission: 0.024, commissionAsset: "USDT",
    time: 2000, isBuyer: false,
  },
  {
    id: 102, orderId: 20, symbol: "BTCUSDT", price: 13000, qty: 0.003,
    quoteQty: 39, commission: 0.039, commissionAsset: "USDT",
    time: 3000, isBuyer: false,
  },
];

describe("SELL partial-fill cumulative lifecycle", () => {
  it("reconciles PARTIALLY_FILLED then CANCELED snapshots without duplicating earlier fills", () => {
    const first = reconcileConfirmedSellFills({
      orderId: 20, symbol: "BTCUSDT", executedQty: 0.002, cummulativeQuoteQty: 24,
    }, sellTrades.slice(0, 1), "BTC", "USDT");
    expect(first.complete).toBe(true);
    expect(first.fills.map((fill) => fill.fillId)).toEqual(["101"]);

    const terminal = reconcileConfirmedSellFills({
      orderId: 20, symbol: "BTCUSDT", executedQty: 0.005, cummulativeQuoteQty: 63,
    }, sellTrades, "BTC", "USDT");
    expect(terminal.complete).toBe(true);
    expect(terminal.fills.map((fill) => fill.fillId)).toEqual(["101", "102"]);

    const previouslySaved = new Map(first.fills.map((fill) => [fill.fillId, fill]));
    for (const fill of terminal.fills) {
      const existing = previouslySaved.get(fill.fillId);
      if (existing) {
        expect(existing).toEqual(fill);
      } else {
        previouslySaved.set(fill.fillId, fill);
      }
    }
    expect([...previouslySaved.keys()]).toEqual(["101", "102"]);

    const ledger = replayPositionLedger([
      buyFill,
      ...[...previouslySaved.values()].map((fill) => ({ ...fill, sellKind: "take_profit" })),
    ]);
    expect(ledger.baseQty).toBeCloseTo(0.005);
    expect(ledger.cycleQty).toBeCloseTo(0);
    expect(ledger.totalQty).toBeCloseTo(0.005);
    expect(ledger.realizedSellCount).toBe(2);
  });

  it("applies base_reduce only to the protected base bucket", () => {
    const baseReduction: ExecutionFill & { sellKind: string } = {
      fillId: "103",
      orderId: "21",
      symbol: "BTCUSDT",
      side: "SELL",
      time: 4000,
      price: 14000,
      qty: 0.001,
      quoteQty: 14,
      commission: 0,
      commissionAsset: "USDT",
      commissionUsdt: 0,
      sellKind: "base_reduce",
    };
    const ledger = replayPositionLedger([buyFill, baseReduction]);
    expect(ledger.baseQty).toBeCloseTo(0.004);
    expect(ledger.cycleQty).toBeCloseTo(0.005);
    expect(ledger.totalQty).toBeCloseTo(0.009);
  });
});
