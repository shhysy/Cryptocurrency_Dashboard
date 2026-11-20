import { describe, expect, it } from "vitest";
import {
  localSellStatusAfterReconciledSnapshot,
  localEventEligibleForTakeProfitResume,
} from "./sell-order-status";
import { buildSellEventReservations, takeProfitTierCanResume } from "./sell-signal-queue";
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
});

describe("sync 非终态 wait 后冻结：首 tick 不得 resume", () => {
  it("Binance NEW 零成交 → 本地状态映射为 reconcile_required", () => {
    expect(localSellStatusAfterReconciledSnapshot({
      exchangeStatus: "NEW", executedQty: 0, origQty: 0.15,
    })).toBe("reconcile_required");
  });

  it("旧 IndexedDB partially_filled 被冻结为 reconcile_required 后，入队不得创建 resume", () => {
    const frozen: SellEventRecord = {
      eventKey: "sell:BTC:take_profit:2:止盈1",
      symbol: "BTC",
      kind: "take_profit",
      status: "reconcile_required",
      requestedQty: 0.15,
      filledQty: 0.05,
      createdAt: 1,
      updatedAt: 2,
      exchangeOrderId: "103",
      fillIds: ["BTC-4"],
      lastError: "订单仍在交易所挂起",
      exchangeTerminalStatus: undefined,
      fillReconcileCompletedAt: undefined,
    };
    expect(localEventEligibleForTakeProfitResume(frozen)).toBe(false);
    expect(takeProfitTierCanResume([frozen], ":止盈1")).toBe(false);
    const plan = buildSellEventReservations(data(), [frozen]);
    expect(plan.records).toHaveLength(0);
  });
});
