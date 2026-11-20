import { describe, expect, it } from "vitest";
import {
  buildSellEventReservations,
  confirmedBaseReduceFilledQty,
  isTerminalReconciledPartial,
  protectedBaseQtyAfterReductions,
  takeProfitTierFullyFilled,
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

describe("底仓减仓后周期仓可卖重算", () => {
  it("已确认底仓减仓成交后，受保护底仓减少", () => {
    expect(protectedBaseQtyAfterReductions(1, 0.4, 0)).toBeCloseTo(0.4);
    expect(protectedBaseQtyAfterReductions(1, 0.4, 0.1)).toBeCloseTo(0.3);
    expect(confirmedBaseReduceFilledQty([{
      eventKey: "sell:BTC:base_reduce:x",
      symbol: "BTC", kind: "base_reduce", status: "executed",
      requestedQty: 0.1, filledQty: 0.1, createdAt: 1, updatedAt: 1,
      exchangeOrderId: "1", fillIds: ["f1"], lastError: null,
      exchangeTerminalStatus: "FILLED", fillReconcileCompletedAt: 1_700_000_000_000,
    }], [{ symbol: "BTC", fillId: "f1", qty: 0.1, side: "SELL", sellKind: "base_reduce" }])).toBeCloseTo(0.1);
  });

  it("底仓减仓已成交后，普通止盈仍可按重算后的周期仓预约", () => {
    const existing: SellEventRecord[] = [{
      eventKey: "sell:BTC:base_reduce:old",
      symbol: "BTC", kind: "base_reduce", status: "executed",
      requestedQty: 0.1, filledQty: 0.1, createdAt: 1, updatedAt: 1,
      exchangeOrderId: "9", fillIds: ["br1"], lastError: null,
      exchangeTerminalStatus: "FILLED", fillReconcileCompletedAt: 1_700_000_000_000,
    }];
    const plan = buildSellEventReservations(data({
      coins: [{
        symbol: "BTC", name: "Bitcoin", color: "#f7931a", price: 60000,
        change24h: 0, qty: 0.9, marketValue: 54000, avgCost: 30000, invested: 30000,
        returnPct: 1, toDoublePct: 0, doubleProgress: 1,
        series: [{ t: 1, c: 50000 }, { t: 2, c: 51000 }, { t: 3, c: 52000 }],
        buys: [{ id: "buy-1", t: 1, price: 30000, qty: 1, position: "mid" }],
        signal: sellSignal,
      }],
    }), existing);
    // 无台账时底仓减仓 fail-closed 不减少保护量；止盈仍可按周期仓预约
    expect(plan.records).toHaveLength(1);
    expect(plan.records[0].requestedQty).toBeCloseTo(0.15);
  });
});

describe("止盈部分成交后安全续卖", () => {
  it("同档 fully filled 后不再新建", () => {
    const existing: SellEventRecord[] = [{
      eventKey: "sell:BTC:take_profit:2:止盈1",
      symbol: "BTC", kind: "take_profit", status: "executed",
      requestedQty: 0.15, filledQty: 0.15, createdAt: 1, updatedAt: 1,
      exchangeOrderId: "1", fillIds: ["a"], lastError: null,
    }];
    expect(takeProfitTierFullyFilled(existing, ":止盈1")).toBe(true);
    expect(buildSellEventReservations(data(), existing).records).toHaveLength(0);
  });

  it("部分成交终态且对账完整时，可对剩余目标生成 resume", () => {
    const existing: SellEventRecord[] = [{
      eventKey: "sell:BTC:take_profit:2:止盈1",
      symbol: "BTC", kind: "take_profit", status: "partially_filled",
      requestedQty: 0.15, filledQty: 0.05, createdAt: 1, updatedAt: 1,
      exchangeOrderId: "1", fillIds: ["a"], lastError: null,
      exchangeTerminalStatus: "CANCELED", fillReconcileCompletedAt: 1_700_000_000_000, lotStepSize: 0.00001,
    }];
    expect(isTerminalReconciledPartial(existing[0])).toBe(true);
    expect(takeProfitTierFullyFilled(existing, ":止盈1")).toBe(false);
    const plan = buildSellEventReservations(data(), existing);
    expect(plan.records).toHaveLength(1);
    expect(plan.records[0].eventKey).toContain("resume");
    expect(plan.records[0].requestedQty).toBeCloseTo(0.1, 8);
  });

  it("仅有 partially_filled 但无成交明细时禁止续卖", () => {
    const existing: SellEventRecord[] = [{
      eventKey: "sell:BTC:take_profit:2:止盈1",
      symbol: "BTC", kind: "take_profit", status: "partially_filled",
      requestedQty: 0.15, filledQty: 0.05, createdAt: 1, updatedAt: 1,
      exchangeOrderId: "1", fillIds: [], lastError: null,
    }];
    expect(isTerminalReconciledPartial(existing[0])).toBe(false);
    expect(buildSellEventReservations(data(), existing).records).toHaveLength(0);
  });

  it("仍有 reconcile_required 时禁止续卖", () => {
    const existing: SellEventRecord[] = [{
      eventKey: "sell:BTC:take_profit:2:止盈1",
      symbol: "BTC", kind: "take_profit", status: "reconcile_required",
      requestedQty: 0.15, filledQty: 0.05, createdAt: 1, updatedAt: 1,
      exchangeOrderId: "1", fillIds: ["a"], lastError: "timeout",
    }];
    const plan = buildSellEventReservations(data(), existing);
    expect(plan.records).toHaveLength(0);
    expect(plan.blocked.some((b) => b.reason.includes("对账") || b.reason.includes("待处理"))).toBe(true);
  });
});
