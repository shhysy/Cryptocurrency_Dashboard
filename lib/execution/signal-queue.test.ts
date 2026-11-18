import { describe, expect, it } from "vitest";
import { buildBuyOrderIntents } from "./signal-queue";
import type { DashboardData } from "../types";

const signal = {
  symbol: "BTC",
  group: "core" as const,
  kind: "accumulate" as const,
  tag: "头仓" as const,
  score: 88,
  breakdown: { pricePosition: 40, sentiment: 25, trend: 15, rsi: 20, ma: 30 },
  reasons: [],
  action: {
    kind: "head",
    label: "头仓",
    side: "buy" as const,
    plannedUsdt: 200,
    usdt: 180,
    qty: 0.003,
    sellPct: null,
    limits: [],
    blocked: [],
    notes: [],
  },
  metrics: {
    weeklyRsi: 30, ma200: 50000, fearGreed: 20, stableCount: 3,
    stabilized: true, stableItems: [true, true, true], btcState: "bull" as const, returnPct: null,
  },
};

const dashboard = (over: Partial<DashboardData> = {}): DashboardData => ({
  source: "binance",
  updatedAt: 1_800_000_000_000,
  stale: false,
  staleReasons: [],
  notes: [],
  account: { assets: [], cashUsdt: 50 },
  summary: {
    totalAssets: 50, totalValue: 0, totalInvested: 0, pnl: 0,
    pnlPct: 0, investedCny: 0, usdtCny: 7,
  },
  equityCurve: [],
  allocation: [],
  coins: [{
    symbol: "BTC", name: "Bitcoin", color: "#f7931a", price: 60000,
    change24h: 0, qty: 0, marketValue: 0, avgCost: null, invested: 0,
    returnPct: null, toDoublePct: null, doubleProgress: 0,
    series: [{ t: 1, c: 50000 }, { t: 2, c: 51000 }, { t: 3, c: 52000 }],
    buys: [], signal,
  }],
  trades: [],
  verdict: { kind: "accumulate", primary: null, others: [], reasons: [] },
  market: { fearGreed: 20, btcState: "bull", accountKnown: true },
  config: { doubleLine: 1, mailScoreCore: 55, mailScoreAlt: 75 },
  ...over,
});

describe("V3.3 buy signal queue bridge", () => {
  it("uses the post-cap action amount and the last closed weekly candle in a stable event key", () => {
    const [intent] = buildBuyOrderIntents(dashboard());
    expect(intent).toMatchObject({
      eventKey: "BTC:head:头仓:2",
      symbol: "BTC",
      plannedUsdt: 180,
      quoteAsset: "USDT",
      strategyLabel: "头仓",
      strategyVersion: "V3.3",
    });
  });

  it("does not queue mock, stale, or account-unknown data", () => {
    expect(buildBuyOrderIntents(dashboard({ source: "mock" }))).toHaveLength(0);
    expect(buildBuyOrderIntents(dashboard({ stale: true }))).toHaveLength(0);
    expect(buildBuyOrderIntents(dashboard({ market: { ...dashboard().market, accountKnown: false } }))).toHaveLength(0);
  });

  it("does not queue blocked, sell, or signal-only actions", () => {
    const blocked = dashboard({
      coins: [{ ...dashboard().coins[0], signal: { ...signal, action: { ...signal.action, blocked: ["stale"] } } }],
    });
    const sell = dashboard({
      coins: [{ ...dashboard().coins[0], signal: { ...signal, action: { ...signal.action, side: "sell" } } }],
    });
    const signalOnly = dashboard({
      coins: [{ ...dashboard().coins[0], signal: { ...signal, action: { ...signal.action, usdt: null } } }],
    });
    expect(buildBuyOrderIntents(blocked)).toHaveLength(0);
    expect(buildBuyOrderIntents(sell)).toHaveLength(0);
    expect(buildBuyOrderIntents(signalOnly)).toHaveLength(0);
  });
});
