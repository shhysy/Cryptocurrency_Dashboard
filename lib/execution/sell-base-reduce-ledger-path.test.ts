import { describe, expect, it } from "vitest";
import {
  buildSellEventReservations,
  confirmedBaseReduceFilledQty,
  hasUnverifiedBaseReduceClaims,
} from "./sell-signal-queue";
import type { SellEventRecord } from "./sell-store.browser";
import type { DashboardData } from "../types";

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

const data = (): DashboardData => ({
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
    change24h: 0, qty: 0.9, marketValue: 54000, avgCost: 30000, invested: 30000,
    returnPct: 1, toDoublePct: 0, doubleProgress: 1,
    series: [{ t: 1, c: 50000 }, { t: 2, c: 51000 }, { t: 3, c: 52000 }],
    buys: [{ id: "buy-1", t: 1, price: 30000, qty: 1, position: "mid" }],
    signal: sellSignal,
  }],
  trades: [],
  verdict: { kind: "sell", primary: sellSignal, others: [], reasons: [] },
  market: { fearGreed: 90, btcState: "bull", accountKnown: true },
  config: { doubleLine: 1, mailScoreCore: 55, mailScoreAlt: 75 },
});

const baseEvent: SellEventRecord = {
  eventKey: "sell:BTC:base_reduce:old",
  symbol: "BTC",
  kind: "base_reduce",
  status: "executed",
  requestedQty: 0.1,
  filledQty: 0.1,
  createdAt: 1,
  updatedAt: 1,
  exchangeOrderId: "9",
  fillIds: ["br1"],
  lastError: null,
  exchangeTerminalStatus: "FILLED",
  fillReconcileCompletedAt: 1_700_000_000_000,
};

describe("buildSellEventReservations 台账链路", () => {
  it("无台账且存在底仓宣称成交 → 阻断卖出计划", () => {
    expect(hasUnverifiedBaseReduceClaims([baseEvent])).toBe(true);
    const plan = buildSellEventReservations(data(), [baseEvent]);
    expect(plan.records).toHaveLength(0);
    expect(plan.blocked.some((b) => b.reason.includes("台账"))).toBe(true);
  });

  it("传入台账后可核验并允许止盈预约", () => {
    const ledger = [
      { symbol: "BTCUSDT", fillId: "br1", qty: 0.1, side: "SELL", sellKind: "base_reduce" as const },
    ];
    expect(confirmedBaseReduceFilledQty([baseEvent], ledger)).toBeCloseTo(0.1);
    expect(hasUnverifiedBaseReduceClaims([baseEvent], ledger)).toBe(false);
    const plan = buildSellEventReservations(data(), [baseEvent], { ledgerFills: ledger });
    expect(plan.records).toHaveLength(1);
    expect(plan.records[0].kind).toBe("take_profit");
  });
});
