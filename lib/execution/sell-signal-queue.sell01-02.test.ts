import { describe, expect, it } from "vitest";
import {
  buildSellEventReservations,
  hasOpenBaseReduce,
  takeProfitTierCanResume,
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

describe("GROK-SELL-01 同周部分成交恢复", () => {
  it("活动 pending 订单存在时不得 resume", () => {
    const existing: SellEventRecord[] = [
      {
        eventKey: "sell:BTC:take_profit:2:止盈1",
        symbol: "BTC", kind: "take_profit", status: "partially_filled",
        requestedQty: 0.15, filledQty: 0.05, createdAt: 1, updatedAt: 1,
        exchangeOrderId: "1", fillIds: ["a"], lastError: null,
        exchangeTerminalStatus: "CANCELED", fillReconcileCompletedAt: 1_700_000_000_000, lotStepSize: 0.00001,
      },
      {
        eventKey: "sell:BTC:take_profit:2:止盈1:resume:0.05",
        symbol: "BTC", kind: "take_profit", status: "pending",
        requestedQty: 0.1, createdAt: 2, updatedAt: 2,
        exchangeOrderId: null, fillIds: [], lastError: null,
      },
    ];
    expect(takeProfitTierCanResume(existing, ":止盈1")).toBe(false);
    expect(buildSellEventReservations(data(), existing).records).toHaveLength(0);
  });

  it("终态全成交后不得再 resume", () => {
    const existing: SellEventRecord[] = [{
      eventKey: "sell:BTC:take_profit:2:止盈1",
      symbol: "BTC", kind: "take_profit", status: "executed",
      requestedQty: 0.15, filledQty: 0.15, createdAt: 1, updatedAt: 1,
      exchangeOrderId: "1", fillIds: ["a"], lastError: null,
      exchangeTerminalStatus: "FILLED", fillReconcileCompletedAt: 1_700_000_000_000,
    }];
    expect(buildSellEventReservations(data(), existing).records).toHaveLength(0);
  });

  it("终态零成交（filledQty=0）不得按 partial resume", () => {
    const existing: SellEventRecord[] = [{
      eventKey: "sell:BTC:take_profit:2:止盈1",
      symbol: "BTC", kind: "take_profit", status: "partially_filled",
      requestedQty: 0.15, filledQty: 0, createdAt: 1, updatedAt: 1,
      exchangeOrderId: "1", fillIds: [], lastError: null,
      exchangeTerminalStatus: "CANCELED", fillReconcileCompletedAt: 1_700_000_000_000, lotStepSize: 0.00001,
    }];
    const plan = buildSellEventReservations(data(), existing);
    expect(plan.records).toHaveLength(0);
  });
});

describe("GROK-SELL-02 跨周底仓减仓锁", () => {
  it("跨周 reconcile_required 仍占用", () => {
    const existing: SellEventRecord[] = [{
      eventKey: "sell:BTC:base_reduce:1:底仓减仓",
      symbol: "BTC", kind: "base_reduce", status: "reconcile_required",
      requestedQty: 0.2, createdAt: 1, updatedAt: 1,
      exchangeOrderId: "9", fillIds: [], lastError: "timeout",
    }];
    expect(hasOpenBaseReduce(existing)).toBe(true);
  });

  it("跨周 partial 无终态证明视为未知，冻结该币全部卖出", () => {
    const later = data({
      coins: [{
        ...data().coins[0],
        series: [{ t: 9, c: 50000 }, { t: 10, c: 51000 }, { t: 11, c: 52000 }],
      }],
    });
    const existing: SellEventRecord[] = [{
      eventKey: "sell:BTC:base_reduce:1:底仓减仓",
      symbol: "BTC", kind: "base_reduce", status: "partially_filled",
      requestedQty: 0.2, filledQty: 0.05, createdAt: 1, updatedAt: 1,
      exchangeOrderId: "9", fillIds: ["x"], lastError: null,
    }];
    expect(hasOpenBaseReduce(existing)).toBe(true);
    const plan = buildSellEventReservations(later, existing);
    expect(plan.records).toHaveLength(0);
    expect(plan.blocked.some((b) =>
      b.reason.includes("未完结底仓") || b.reason.includes("台账") || b.reason.includes("冻结")
    )).toBe(true);
  });

  it("旧周终态已证明的底仓减仓不占用，不阻断新止盈", () => {
    const later = data({
      coins: [{
        ...data().coins[0],
        series: [{ t: 9, c: 50000 }, { t: 10, c: 51000 }, { t: 11, c: 52000 }],
      }],
    });
    const existing: SellEventRecord[] = [{
      eventKey: "sell:BTC:base_reduce:1:底仓减仓",
      symbol: "BTC", kind: "base_reduce", status: "executed",
      requestedQty: 0.1, filledQty: 0.1, createdAt: 1, updatedAt: 1,
      exchangeOrderId: "9", fillIds: ["br1"], lastError: null,
      exchangeTerminalStatus: "FILLED", fillReconcileCompletedAt: 1_700_000_000_000,
    }];
    expect(hasOpenBaseReduce(existing)).toBe(false);
    const ledger = [{ symbol: "BTCUSDT", fillId: "br1", qty: 0.1, side: "SELL", sellKind: "base_reduce" as const }];
    const plan = buildSellEventReservations(later, existing, { ledgerFills: ledger });
    expect(plan.records).toHaveLength(1);
  });
});
