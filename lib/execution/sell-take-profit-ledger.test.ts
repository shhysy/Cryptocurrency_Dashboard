import { describe, expect, it } from "vitest";
import {
  buildSellEventReservations,
  hasUnverifiedTakeProfitClaims,
  takeProfitTierCanResume,
  verifiedTakeProfitEventFilledQty,
} from "./sell-signal-queue";
import type { SellEventRecord } from "./sell-store.browser";
import type { DashboardData } from "../types";
import type { TradeLedgerEntry } from "./types";

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

function partial(over: Partial<SellEventRecord> = {}): SellEventRecord {
  return {
    eventKey: "sell:BTC:take_profit:2:止盈1",
    symbol: "BTC",
    kind: "take_profit",
    status: "partially_filled",
    requestedQty: 0.15,
    filledQty: 0.05,
    createdAt: 1,
    updatedAt: 1,
    exchangeOrderId: "1",
    fillIds: ["f1"],
    lastError: null,
    exchangeTerminalStatus: "CANCELED",
    fillReconcileCompletedAt: 1_700_000_000_000,
    lotStepSize: 0.00001,
    ...over,
  };
}

function ledgerRow(over: Partial<TradeLedgerEntry> & { fillId: string; qty: number }): TradeLedgerEntry {
  return {
    id: `ledger-${over.fillId}`,
    fillId: over.fillId,
    orderId: over.orderId ?? "1",
    symbol: over.symbol ?? "BTCUSDT",
    side: over.side ?? "SELL",
    time: over.time ?? 1,
    price: over.price ?? 60000,
    qty: over.qty,
    quoteQty: over.quoteQty ?? over.qty * 60000,
    commission: over.commission ?? 0,
    commissionAsset: over.commissionAsset ?? "USDT",
    commissionUsdt: over.commissionUsdt ?? 0,
    realizedPnlUsdt: over.realizedPnlUsdt ?? null,
    sellKind: over.sellKind ?? "take_profit",
  };
}

describe("GROK-SELL-01A 止盈 resume 台账核验", () => {
  it("无台账禁止 resume 并阻断", () => {
    const e = [partial()];
    expect(verifiedTakeProfitEventFilledQty(e[0])).toBeNull();
    expect(hasUnverifiedTakeProfitClaims(e, ":止盈1")).toBe(true);
    expect(takeProfitTierCanResume(e, ":止盈1")).toBe(false);
    const plan = buildSellEventReservations(data(), e);
    expect(plan.records).toHaveLength(0);
    expect(plan.blocked.some((b) => b.reason.includes("台账"))).toBe(true);
  });

  it("错误 symbol（同 fillId）必须拒绝", () => {
    const e = [partial()];
    expect(verifiedTakeProfitEventFilledQty(e[0], [
      { symbol: "ETHUSDT", fillId: "f1", qty: 0.05, side: "SELL", sellKind: "take_profit" },
    ])).toBeNull();
  });

  it("台账缺 fill / 错误 side / 错误 sellKind 禁止 resume", () => {
    const e = [partial()];
    expect(verifiedTakeProfitEventFilledQty(e[0], [
      { symbol: "BTC", fillId: "other", qty: 0.05, side: "SELL", sellKind: "take_profit" },
    ])).toBeNull();
    expect(verifiedTakeProfitEventFilledQty(e[0], [
      { symbol: "BTC", fillId: "f1", qty: 0.05, side: "BUY", sellKind: "take_profit" },
    ])).toBeNull();
    expect(verifiedTakeProfitEventFilledQty(e[0], [
      { symbol: "BTC", fillId: "f1", qty: 0.05, side: "SELL", sellKind: "base_reduce" },
    ])).toBeNull();
  });

  it("重复 fillId 冲突禁止 resume", () => {
    const e = [partial()];
    expect(verifiedTakeProfitEventFilledQty(e[0], [
      { symbol: "BTC", fillId: "f1", qty: 0.03, side: "SELL", sellKind: "take_profit" },
      { symbol: "BTC", fillId: "f1", qty: 0.02, side: "SELL", sellKind: "take_profit" },
    ])).toBeNull();
  });

  it("同键混合冲突：错误 side/kind 与有效行并存时不得误认", () => {
    const e = [partial()];
    expect(verifiedTakeProfitEventFilledQty(e[0], [
      { symbol: "BTC", fillId: "f1", qty: 0.05, side: "BUY", sellKind: "take_profit" },
      { symbol: "BTC", fillId: "f1", qty: 0.05, side: "SELL", sellKind: "take_profit" },
    ])).toBeCloseTo(0.05);
    expect(verifiedTakeProfitEventFilledQty(e[0], [
      { symbol: "BTC", fillId: "f1", qty: 0.05, side: "SELL", sellKind: "take_profit" },
      { symbol: "BTC", fillId: "f1", qty: 0.05, side: "SELL", sellKind: "take_profit" },
    ])).toBeNull();
    expect(verifiedTakeProfitEventFilledQty(e[0], [
      { symbol: "BTC", fillId: "f1", qty: 0.05, side: "SELL", sellKind: "base_reduce" },
      { symbol: "BTC", fillId: "f1", qty: 0.05, side: "SELL", sellKind: "take_profit" },
    ])).toBeCloseTo(0.05);
  });

  it("数量与 filledQty 不一致禁止 resume", () => {
    const e = [partial()];
    expect(verifiedTakeProfitEventFilledQty(e[0], [
      { symbol: "BTC", fillId: "f1", qty: 0.04, side: "SELL", sellKind: "take_profit" },
    ])).toBeNull();
  });

  it("合法台账允许 resume，剩余量=目标-已核验成交", () => {
    const e = [partial()];
    const ledger = [
      { symbol: "BTCUSDT", fillId: "f1", qty: 0.05, side: "SELL", sellKind: "take_profit" as const },
    ];
    expect(verifiedTakeProfitEventFilledQty(e[0], ledger)).toBeCloseTo(0.05);
    expect(takeProfitTierCanResume(e, ":止盈1", ledger)).toBe(true);
    const plan = buildSellEventReservations(data(), e, { ledgerFills: ledger });
    expect(plan.records).toHaveLength(1);
    expect(plan.records[0].requestedQty).toBeCloseTo(0.1, 8);
  });

  it("真实 TradeLedgerEntry 手续费字段再大也不计入成交数量", () => {
    const e = [partial()];
    const row = ledgerRow({
      fillId: "f1",
      qty: 0.05,
      commission: 999,
      commissionAsset: "BNB",
      commissionUsdt: 50,
      sellKind: "take_profit",
      side: "SELL",
      symbol: "BTCUSDT",
    });
    expect(verifiedTakeProfitEventFilledQty(e[0], [{
      symbol: row.symbol,
      fillId: row.fillId,
      qty: row.qty,
      side: row.side,
      sellKind: row.sellKind,
    }])).toBeCloseTo(0.05);
    expect(row.qty + row.commission).toBeGreaterThan(0.05);
  });
});
