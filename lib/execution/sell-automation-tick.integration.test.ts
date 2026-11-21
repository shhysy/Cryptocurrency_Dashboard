import { beforeEach, describe, expect, it, vi } from "vitest";

const listSellEvents = vi.fn();
const updateSellEvent = vi.fn();
const reserveSellEvent = vi.fn();
const fetchSpotOrderById = vi.fn();
const fetchSpotOrderByClientId = vi.fn();
const fetchSpotTradesForOrder = vi.fn();
const fetchSpotSymbolFilters = vi.fn();
const recordConfirmedSellFill = vi.fn();
const listTradeLedger = vi.fn();

vi.mock("./sell-store.browser", () => ({
  listSellEvents: (...args: unknown[]) => listSellEvents(...args),
  updateSellEvent: (...args: unknown[]) => updateSellEvent(...args),
  reserveSellEvent: (...args: unknown[]) => reserveSellEvent(...args),
  bindSellEventToExchangeOrder: vi.fn(),
  canTransitionSellEventStatus: () => true,
}));

vi.mock("../binance.browser", () => ({
  fetchSpotOrderById: (...args: unknown[]) => fetchSpotOrderById(...args),
  fetchSpotOrderByClientId: (...args: unknown[]) => fetchSpotOrderByClientId(...args),
  fetchSpotTradesForOrder: (...args: unknown[]) => fetchSpotTradesForOrder(...args),
  fetchSpotSymbolFilters: (...args: unknown[]) => fetchSpotSymbolFilters(...args),
  BINANCE_SPOT_SELL_SUBMISSION_ENABLED: false,
}));

vi.mock("./store.browser", () => ({
  recordConfirmedSellFill: (...args: unknown[]) => recordConfirmedSellFill(...args),
  listTradeLedger: (...args: unknown[]) => listTradeLedger(...args),
}));

vi.mock("./sell-order-submit.browser", () => ({
  submitQueuedSellEvent: vi.fn(async () => ({ ok: false })),
  submitQueuedSellOrders: vi.fn(async () => ({ submitted: 0, skipped: 0, failed: 0 })),
}));

vi.mock("./notification-dispatch.browser", () => ({
  dispatchPendingTradeNotifications: vi.fn(async () => ({ sent: 0, failed: 0 })),
}));

import { syncSellOrderFromBinance } from "./sync-sell-order.browser";
import { runSellAutomationTick } from "./sell-automation-tick";
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
  updatedAt: Date.now(),
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

const legacyPartial = {
  eventKey: "sell:BTC:take_profit:2:止盈1",
  symbol: "BTC",
  kind: "take_profit" as const,
  status: "partially_filled" as const,
  requestedQty: 0.15,
  filledQty: 0.05,
  createdAt: 1,
  updatedAt: 1,
  exchangeOrderId: "103",
  clientOrderId: "c1",
  fillIds: ["BTC-4"],
  lastError: null as string | null,
  exchangeTerminalStatus: "CANCELED" as string | undefined,
  fillReconcileCompletedAt: 1_700_000_000_000 as number | undefined,
  lotStepSize: 0.00001 as number | undefined,
};

describe("sync/tick 集成：wait 冻结与不 resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listTradeLedger.mockResolvedValue([]);
    updateSellEvent.mockImplementation(async (e: unknown) => e);
    listSellEvents.mockResolvedValue([]);
    reserveSellEvent.mockResolvedValue({ created: false, record: {} });
  });

  it("NEW 活动单 + 旧终态证明：sync 降为 reconcile_required 并清证明", async () => {
    listSellEvents.mockResolvedValue([{ ...legacyPartial }]);
    fetchSpotOrderById.mockResolvedValue({
      symbol: "BTCUSDT",
      orderId: 103,
      clientOrderId: "c1",
      status: "NEW",
      origQty: "0.15",
      executedQty: "0",
      cummulativeQuoteQty: "0",
      transactTime: Date.now(),
    });

    const result = await syncSellOrderFromBinance("sell:BTC:take_profit:2:止盈1");
    expect(result.action).toBe("wait");
    expect(updateSellEvent).toHaveBeenCalled();
    const saved = updateSellEvent.mock.calls[0][0];
    expect(saved.status).toBe("reconcile_required");
    expect(saved.exchangeTerminalStatus).toBeUndefined();
    expect(saved.fillReconcileCompletedAt).toBeUndefined();
  });

  it("冻结后 runSellAutomationTick 不会创建 resume 事件", async () => {
    const frozen = {
      ...legacyPartial,
      status: "reconcile_required" as const,
      exchangeTerminalStatus: undefined,
      fillReconcileCompletedAt: undefined,
      lastError: "仍未终态",
    };
    listSellEvents.mockResolvedValue([frozen]);
    fetchSpotOrderById.mockResolvedValue({
      symbol: "BTCUSDT",
      orderId: 103,
      clientOrderId: "c1",
      status: "NEW",
      origQty: "0.15",
      executedQty: "0",
      cummulativeQuoteQty: "0",
      transactTime: Date.now(),
    });

    const tick = await runSellAutomationTick(data(), { attemptLiveSubmit: false });
    expect(tick.enqueued).toBe(0);
    const resumeCalls = reserveSellEvent.mock.calls.filter((call) => {
      const record = call[0] as { eventKey?: string } | undefined;
      return String(record?.eventKey || "").includes("resume");
    });
    expect(resumeCalls).toHaveLength(0);
  });

  it("reconcile_required 残留终态证明 + NEW：同步后清除证明且不 resume", async () => {
    const dirty = {
      ...legacyPartial,
      status: "reconcile_required" as const,
      exchangeTerminalStatus: "CANCELED",
      fillReconcileCompletedAt: 1_700_000_000_000,
      lotStepSize: 0.00001,
      lastError: "脏数据",
    };
    listSellEvents.mockResolvedValue([{ ...dirty }]);
    fetchSpotOrderById.mockResolvedValue({
      symbol: "BTCUSDT",
      orderId: 103,
      clientOrderId: "c1",
      status: "NEW",
      origQty: "0.15",
      executedQty: "0",
      cummulativeQuoteQty: "0",
      transactTime: Date.now(),
    });

    const result = await syncSellOrderFromBinance("sell:BTC:take_profit:2:止盈1");
    expect(result.action).toBe("wait");
    expect(updateSellEvent).toHaveBeenCalled();
    const saved = updateSellEvent.mock.calls[0][0];
    expect(saved.status).toBe("reconcile_required");
    expect(saved.exchangeTerminalStatus).toBeUndefined();
    expect(saved.fillReconcileCompletedAt).toBeUndefined();

    listSellEvents.mockResolvedValue([{ ...saved }]);
    const tick = await runSellAutomationTick(data(), { attemptLiveSubmit: false });
    expect(tick.enqueued).toBe(0);
  });

  it("终态 partial + 合法 take_profit 台账：tick 可 enqueue resume", async () => {
    const terminalPartial = {
      eventKey: "sell:BTC:take_profit:2:止盈1",
      symbol: "BTC",
      kind: "take_profit" as const,
      status: "partially_filled" as const,
      requestedQty: 0.15,
      filledQty: 0.05,
      createdAt: 1,
      updatedAt: 1,
      exchangeOrderId: "103",
      fillIds: ["tp1"],
      lastError: null,
      exchangeTerminalStatus: "CANCELED",
      fillReconcileCompletedAt: 1_700_000_000_000,
      lotStepSize: 0.00001,
    };
    listSellEvents.mockResolvedValue([terminalPartial]);
    listTradeLedger.mockResolvedValue([{
      symbol: "BTCUSDT", fillId: "tp1", qty: 0.05, side: "SELL", sellKind: "take_profit",
      orderId: "103", time: 1, price: 1, quoteQty: 1, commission: 0, commissionAsset: "USDT",
      commissionUsdt: 0, id: "x", realizedPnlUsdt: null,
    }]);
    reserveSellEvent.mockResolvedValue({ created: true, record: { eventKey: "resume" } });
    fetchSpotOrderById.mockResolvedValue({
      symbol: "BTCUSDT",
      orderId: 103,
      clientOrderId: "c1",
      status: "CANCELED",
      origQty: "0.15",
      executedQty: "0.05",
      cummulativeQuoteQty: "3000",
      transactTime: Date.now(),
    });
    fetchSpotTradesForOrder.mockResolvedValue([]);
    fetchSpotSymbolFilters.mockResolvedValue({
      filters: [{ filterType: "LOT_SIZE", stepSize: "0.00001", minQty: "0.00001", maxQty: "1000" }],
    });

    const tick = await runSellAutomationTick(data(), { attemptLiveSubmit: false });
    expect(tick.enqueued).toBeGreaterThanOrEqual(1);
    const resumeCalls = reserveSellEvent.mock.calls.filter((call) => {
      const record = call[0] as { eventKey?: string } | undefined;
      return String(record?.eventKey || "").includes("resume");
    });
    expect(resumeCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("终态 partial 无台账：tick 不得 enqueue resume", async () => {
    const terminalPartial = {
      eventKey: "sell:BTC:take_profit:2:止盈1",
      symbol: "BTC",
      kind: "take_profit" as const,
      status: "partially_filled" as const,
      requestedQty: 0.15,
      filledQty: 0.05,
      createdAt: 1,
      updatedAt: 1,
      exchangeOrderId: "103",
      fillIds: ["tp1"],
      lastError: null,
      exchangeTerminalStatus: "CANCELED",
      fillReconcileCompletedAt: 1_700_000_000_000,
      lotStepSize: 0.00001,
    };
    listSellEvents.mockResolvedValue([terminalPartial]);
    listTradeLedger.mockResolvedValue([]);
    reserveSellEvent.mockResolvedValue({ created: true, record: {} });

    const tick = await runSellAutomationTick(data(), { attemptLiveSubmit: false });
    expect(tick.enqueued).toBe(0);
    const resumeCalls = reserveSellEvent.mock.calls.filter((call) => {
      const record = call[0] as { eventKey?: string } | undefined;
      return String(record?.eventKey || "").includes("resume");
    });
    expect(resumeCalls).toHaveLength(0);
  });
});
