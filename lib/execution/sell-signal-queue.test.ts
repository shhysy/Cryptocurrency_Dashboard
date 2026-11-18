import { describe, expect, it } from "vitest";
import { buildSellEventReservations } from "./sell-signal-queue";
import type { DashboardData } from "../types";
import type { SellEventRecord } from "./sell-store.browser";

const sellSignal = {
  symbol: "BTC",
  group: "core" as const,
  kind: "sell" as const,
  tag: "止盈" as const,
  score: 90,
  breakdown: { pricePosition: 0, sentiment: 0, trend: 0, rsi: 0, ma: 0 },
  reasons: [],
  action: {
    kind: "takeProfit",
    label: "止盈1",
    side: "sell" as const,
    plannedUsdt: null,
    usdt: 1000,
    qty: 0.15,
    sellPct: 0.15,
    limits: [],
    blocked: [],
    notes: [],
  },
  metrics: {
    weeklyRsi: 80, ma200: 50000, fearGreed: 90, stableCount: 0,
    stabilized: false, stableItems: [false, false, false], btcState: "bull" as const, returnPct: 1,
  },
};

const data = (over: Partial<DashboardData> = {}): DashboardData => ({
  source: "binance",
  updatedAt: 1_800_000_000_000,
  stale: false,
  staleReasons: [],
  notes: [],
  account: { assets: [], cashUsdt: 20 },
  summary: { totalAssets: 20, totalValue: 0, totalInvested: 0, pnl: 0, pnlPct: 0, investedCny: 0, usdtCny: 7.1 },
  equityCurve: [],
  allocation: [],
  coins: [{
    symbol: "BTC", name: "Bitcoin", color: "#f7931a", price: 60000,
    change24h: 0, qty: 1, marketValue: 60000, avgCost: 30000, invested: 30000,
    returnPct: 1, toDoublePct: 0, doubleProgress: 1,
    series: [{ t: 1, c: 50000 }, { t: 2, c: 51000 }, { t: 3, c: 52000 }],
    buys: [{ id: "buy-1", t: 1, price: 30000, qty: 1, position: "mid" }],
    signal: sellSignal,
  }],
  trades: [],
  verdict: { kind: "sell", primary: sellSignal, others: [], reasons: [] },
  market: { fearGreed: 90, btcState: "bull", accountKnown: true },
  config: { doubleLine: 1, mailScoreCore: 55, mailScoreAlt: 75 },
  ...over,
});

describe("V3.3 sell signal reservation", () => {
  it("creates a stable take-profit event limited to cycle holdings", () => {
    const plan = buildSellEventReservations(data(), []);
    expect(plan.records).toHaveLength(1);
    expect(plan.records[0]).toMatchObject({
      eventKey: "sell:BTC:take_profit:2:止盈1",
      status: "pending",
      requestedQty: 0.15,
    });
  });

  it("does not reserve the same event twice", () => {
    const existing: SellEventRecord = {
      eventKey: "sell:BTC:take_profit:2:止盈1",
      symbol: "BTC", kind: "take_profit", status: "pending", requestedQty: 0.15,
      createdAt: 1, updatedAt: 1, exchangeOrderId: null, fillIds: [], lastError: null,
    };
    expect(buildSellEventReservations(data(), [existing]).records).toHaveLength(0);
  });

  it("does not reserve from mock or stale data", () => {
    expect(buildSellEventReservations(data({ source: "mock" }), []).records).toHaveLength(0);
    expect(buildSellEventReservations(data({ stale: true }), []).records).toHaveLength(0);
  });


  it("does not reserve the same take-profit tier again on a later week", () => {
    const later = data({
      coins: [{
        ...data().coins[0],
        series: [{ t: 2, c: 50000 }, { t: 3, c: 51000 }, { t: 4, c: 52000 }],
      }],
    });
    const existing: SellEventRecord = {
      eventKey: "sell:BTC:take_profit:2:止盈1",
      symbol: "BTC", kind: "take_profit", status: "executed", requestedQty: 0.15,
      createdAt: 1, updatedAt: 1, exchangeOrderId: "100", fillIds: ["BTC-1"], lastError: null,
    };
    expect(buildSellEventReservations(later, [existing]).records).toHaveLength(0);
  });

  it("counts pending indicator-profit quantity against the 50% cycle cap", () => {
    const indicator = data({
      coins: [{
        ...data().coins[0],
        signal: { ...sellSignal, action: { ...sellSignal.action, kind: "indicatorProfit", label: "指标止盈", qty: 0.2 } },
      }],
    });
    const existing: SellEventRecord = {
      eventKey: "sell:BTC:indicator_profit:1:指标止盈",
      symbol: "BTC", kind: "indicator_profit", status: "pending", requestedQty: 0.25,
      createdAt: 1, updatedAt: indicator.updatedAt - 15 * 864e5,
      exchangeOrderId: null, fillIds: [], lastError: null,
    };
    const plan = buildSellEventReservations(indicator, [existing]);
    expect(plan.records[0].requestedQty).toBeCloseTo(0.05, 12);
  });

  it("does not reserve a second base-reduction event while one is pending", () => {
    const baseReduce = data({
      coins: [{
        ...data().coins[0],
        signal: { ...sellSignal, action: { ...sellSignal.action, kind: "baseReduce", label: "底仓减仓", qty: 0.2 } },
      }],
    });
    const existing: SellEventRecord = {
      eventKey: "sell:BTC:base_reduce:1:底仓减仓",
      symbol: "BTC", kind: "base_reduce", status: "pending", requestedQty: 0.2,
      createdAt: 1, updatedAt: 1, exchangeOrderId: null, fillIds: [], lastError: null,
    };
    expect(buildSellEventReservations(baseReduce, [existing]).records).toHaveLength(0);
  });


  it("does not double-subtract already executed sells from refreshed account balance", () => {
    const d = data({
      coins: [{
        ...data().coins[0],
        qty: 1,
        signal: { ...sellSignal, action: { ...sellSignal.action, qty: 0.5 } },
      }],
    });
    const executed: SellEventRecord = {
      eventKey: "sell:BTC:trail_stop:1:追踪止损",
      symbol: "BTC", kind: "trail_stop", status: "executed", requestedQty: 0.2,
      createdAt: 1, updatedAt: 1, exchangeOrderId: "101", fillIds: ["BTC-2"], lastError: null,
    };
    const plan = buildSellEventReservations(d, [executed]);
    expect(plan.records[0].requestedQty).toBeCloseTo(0.5, 12);
  });

  it("keeps ordinary take-profit inside the cycle portion", () => {
    const d = data({
      coins: [{
        ...data().coins[0],
        qty: 0.5,
        signal: { ...sellSignal, action: { ...sellSignal.action, qty: 0.5 } },
      }],
    });
    const plan = buildSellEventReservations(d, []);
    expect(plan.records[0].requestedQty).toBeCloseTo(0.1, 12);
  });
});
