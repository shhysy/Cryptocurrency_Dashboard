import { beforeEach, describe, expect, it, vi } from "vitest";

const listSellEvents = vi.fn();
const reserveSellEvent = vi.fn();
const listTradeLedger = vi.fn();

vi.mock("./sell-store.browser", () => ({
  listSellEvents: (...args: unknown[]) => listSellEvents(...args),
  reserveSellEvent: (...args: unknown[]) => reserveSellEvent(...args),
}));

vi.mock("./store.browser", () => ({
  listTradeLedger: (...args: unknown[]) => listTradeLedger(...args),
}));

import { enqueueEligibleSellSignals } from "./sell-signal-queue";
import type { DashboardData } from "../types";
import type { SellEventRecord } from "./sell-store.browser";

function makeSellSignal(symbol: string, qty = 0.15) {
  return {
    symbol,
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
      qty,
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
}

function coin(symbol: string, qty = 0.9) {
  const signal = makeSellSignal(symbol);
  return {
    symbol, name: symbol, color: "#f7931a", price: 60000,
    change24h: 0, qty, marketValue: qty * 60000, avgCost: 30000, invested: 30000,
    returnPct: 1, toDoublePct: 0, doubleProgress: 1,
    series: [{ t: 1, c: 50000 }, { t: 2, c: 51000 }, { t: 3, c: 52000 }],
    buys: [{ id: `buy-${symbol}`, t: 1, price: 30000, qty: 1, position: "mid" as const }],
    signal,
  };
}

function data(symbols: string[] = ["BTC", "ETH"]): DashboardData {
  const coins = symbols.map((s) => coin(s));
  const primary = coins[0].signal;
  return {
    source: "binance",
    updatedAt: 1_800_000_000_000,
    stale: false,
    staleReasons: [],
    notes: [],
    account: { assets: [], cashUsdt: 20 },
    summary: { totalAssets: 20, totalValue: 0, totalInvested: 0, pnl: 0, pnlPct: 0, investedCny: 0, usdtCny: 7.1 },
    equityCurve: [],
    allocation: [],
    coins,
    trades: [],
    verdict: { kind: "sell", primary, others: [], reasons: [] },
    market: { fearGreed: 90, btcState: "bull", accountKnown: true },
    config: { doubleLine: 1, mailScoreCore: 55, mailScoreAlt: 75 },
  };
}

function baseReduce(symbol: string, fillId: string): SellEventRecord {
  return {
    eventKey: `sell:${symbol}:base_reduce:1`,
    symbol,
    kind: "base_reduce",
    status: "executed",
    requestedQty: 0.1,
    filledQty: 0.1,
    createdAt: 1,
    updatedAt: 1,
    exchangeOrderId: "9",
    fillIds: [fillId],
    lastError: null,
    exchangeTerminalStatus: "FILLED",
    fillReconcileCompletedAt: 1_700_000_000_000,
  };
}

describe("enqueueEligibleSellSignals 台账完整性", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reserveSellEvent.mockImplementation(async (record: { eventKey: string }) => ({
      record,
      created: true,
    }));
  });

  it("台账读取异常：有底仓宣称的币阻断，无宣称币可继续", async () => {
    listSellEvents.mockResolvedValue([baseReduce("BTC", "br1")]);
    listTradeLedger.mockRejectedValue(new Error("IDB down"));
    const result = await enqueueEligibleSellSignals(data(["BTC", "ETH"]));
    expect(result.ledgerError).toContain("IDB");
    expect(result.blocked.some((b) => b.symbol === "BTC" && b.reason.includes("台账"))).toBe(true);
    expect(result.blocked.some((b) => b.symbol === "*")).toBe(true);
    expect(result.created).toBeGreaterThanOrEqual(1);
    const ethCreated = reserveSellEvent.mock.calls.some((c) => {
      const r = c[0] as { symbol?: string };
      return r.symbol === "ETH";
    });
    expect(ethCreated).toBe(true);
    const btcCreated = reserveSellEvent.mock.calls.some((c) => {
      const r = c[0] as { symbol?: string };
      return r.symbol === "BTC";
    });
    expect(btcCreated).toBe(false);
  });

  it("重复 fillId：对应币阻断，其他币不阻断", async () => {
    listSellEvents.mockResolvedValue([baseReduce("BTC", "dup"), baseReduce("ETH", "eth1")]);
    listTradeLedger.mockResolvedValue([
      { symbol: "BTCUSDT", fillId: "dup", qty: 0.1, side: "SELL", sellKind: "base_reduce", orderId: "1", time: 1, price: 1, quoteQty: 1, commission: 0, commissionAsset: "USDT", commissionUsdt: 0, id: "a", realizedPnlUsdt: null },
      { symbol: "BTCUSDT", fillId: "dup", qty: 0.1, side: "SELL", sellKind: "base_reduce", orderId: "2", time: 2, price: 1, quoteQty: 1, commission: 0, commissionAsset: "USDT", commissionUsdt: 0, id: "b", realizedPnlUsdt: null },
      { symbol: "ETHUSDT", fillId: "eth1", qty: 0.1, side: "SELL", sellKind: "base_reduce", orderId: "3", time: 3, price: 1, quoteQty: 1, commission: 0, commissionAsset: "USDT", commissionUsdt: 0, id: "c", realizedPnlUsdt: null },
    ]);
    const result = await enqueueEligibleSellSignals(data(["BTC", "ETH"]));
    expect(result.blocked.some((b) => b.symbol === "BTC")).toBe(true);
    expect(result.blocked.some((b) => b.symbol === "ETH")).toBe(false);
    const ethOk = reserveSellEvent.mock.calls.some((c) => (c[0] as { symbol?: string }).symbol === "ETH");
    const btcOk = reserveSellEvent.mock.calls.some((c) => (c[0] as { symbol?: string }).symbol === "BTC");
    expect(ethOk).toBe(true);
    expect(btcOk).toBe(false);
  });

  it("缺少 sellKind 或错误 side：对应币阻断", async () => {
    listSellEvents.mockResolvedValue([baseReduce("BTC", "x1")]);
    listTradeLedger.mockResolvedValue([
      { symbol: "BTCUSDT", fillId: "x1", qty: 0.1, side: "SELL", orderId: "1", time: 1, price: 1, quoteQty: 1, commission: 0, commissionAsset: "USDT", commissionUsdt: 0, id: "a", realizedPnlUsdt: null },
    ]);
    const missingKind = await enqueueEligibleSellSignals(data(["BTC"]));
    expect(missingKind.blocked.some((b) => b.symbol === "BTC")).toBe(true);
    expect(missingKind.created).toBe(0);

    listTradeLedger.mockResolvedValue([
      { symbol: "BTCUSDT", fillId: "x1", qty: 0.1, side: "BUY", sellKind: "base_reduce", orderId: "1", time: 1, price: 1, quoteQty: 1, commission: 0, commissionAsset: "USDT", commissionUsdt: 0, id: "a", realizedPnlUsdt: null },
    ]);
    const wrongSide = await enqueueEligibleSellSignals(data(["BTC"]));
    expect(wrongSide.blocked.some((b) => b.symbol === "BTC")).toBe(true);
  });

  it("完整合法台账：底仓核验通过并创建止盈预约", async () => {
    listSellEvents.mockResolvedValue([baseReduce("BTC", "ok1")]);
    listTradeLedger.mockResolvedValue([
      { symbol: "BTCUSDT", fillId: "ok1", qty: 0.1, side: "SELL", sellKind: "base_reduce", orderId: "1", time: 1, price: 1, quoteQty: 1, commission: 0, commissionAsset: "USDT", commissionUsdt: 0, id: "a", realizedPnlUsdt: null },
    ]);
    const result = await enqueueEligibleSellSignals(data(["BTC"]));
    expect(result.ledgerError).toBeUndefined();
    expect(result.blocked.filter((b) => b.symbol === "BTC")).toHaveLength(0);
    expect(result.created).toBe(1);
  });

  it("止盈 partial：无台账时阻断本币，不误伤无宣称币", async () => {
    listSellEvents.mockResolvedValue([{
      eventKey: "sell:BTC:take_profit:2:止盈1",
      symbol: "BTC",
      kind: "take_profit",
      status: "partially_filled",
      requestedQty: 0.15,
      filledQty: 0.05,
      createdAt: 1,
      updatedAt: 1,
      exchangeOrderId: "1",
      fillIds: ["tp1"],
      lastError: null,
      exchangeTerminalStatus: "CANCELED",
      fillReconcileCompletedAt: 1_700_000_000_000,
      lotStepSize: 0.00001,
    }]);
    listTradeLedger.mockResolvedValue([]);
    const result = await enqueueEligibleSellSignals(data(["BTC", "ETH"]));
    expect(result.blocked.some((b) => b.symbol === "BTC" && b.reason.includes("台账"))).toBe(true);
    const ethOk = reserveSellEvent.mock.calls.some((c) => (c[0] as { symbol?: string }).symbol === "ETH");
    const btcOk = reserveSellEvent.mock.calls.some((c) => (c[0] as { symbol?: string }).symbol === "BTC");
    expect(ethOk).toBe(true);
    expect(btcOk).toBe(false);
  });

  it("止盈 partial：合法 take_profit 台账可 resume", async () => {
    listSellEvents.mockResolvedValue([{
      eventKey: "sell:BTC:take_profit:2:止盈1",
      symbol: "BTC",
      kind: "take_profit",
      status: "partially_filled",
      requestedQty: 0.15,
      filledQty: 0.05,
      createdAt: 1,
      updatedAt: 1,
      exchangeOrderId: "1",
      fillIds: ["tp1"],
      lastError: null,
      exchangeTerminalStatus: "CANCELED",
      fillReconcileCompletedAt: 1_700_000_000_000,
      lotStepSize: 0.00001,
    }]);
    listTradeLedger.mockResolvedValue([{
      symbol: "BTCUSDT", fillId: "tp1", qty: 0.05, side: "SELL", sellKind: "take_profit",
      orderId: "1", time: 1, price: 1, quoteQty: 1, commission: 0, commissionAsset: "USDT",
      commissionUsdt: 0, id: "x", realizedPnlUsdt: null,
    }]);
    const result = await enqueueEligibleSellSignals(data(["BTC"]));
    expect(result.created).toBe(1);
    const key = (reserveSellEvent.mock.calls[0][0] as { eventKey: string }).eventKey;
    expect(key).toContain("resume");
  });

  it("止盈 partial：错误 symbol 台账阻断本币", async () => {
    listSellEvents.mockResolvedValue([{
      eventKey: "sell:BTC:take_profit:2:止盈1",
      symbol: "BTC",
      kind: "take_profit",
      status: "partially_filled",
      requestedQty: 0.15,
      filledQty: 0.05,
      createdAt: 1,
      updatedAt: 1,
      exchangeOrderId: "1",
      fillIds: ["tp1"],
      lastError: null,
      exchangeTerminalStatus: "CANCELED",
      fillReconcileCompletedAt: 1_700_000_000_000,
      lotStepSize: 0.00001,
    }]);
    listTradeLedger.mockResolvedValue([{
      symbol: "ETHUSDT", fillId: "tp1", qty: 0.05, side: "SELL", sellKind: "take_profit",
      orderId: "1", time: 1, price: 1, quoteQty: 1, commission: 0, commissionAsset: "USDT",
      commissionUsdt: 0, id: "x", realizedPnlUsdt: null,
    }]);
    const result = await enqueueEligibleSellSignals(data(["BTC"]));
    expect(result.created).toBe(0);
    expect(result.blocked.some((b) => b.symbol === "BTC")).toBe(true);
  });

  it("止盈 partial：同键混合 BUY+take_profit 台账阻断本币", async () => {
    listSellEvents.mockResolvedValue([{
      eventKey: "sell:BTC:take_profit:2:止盈1",
      symbol: "BTC",
      kind: "take_profit",
      status: "partially_filled",
      requestedQty: 0.15,
      filledQty: 0.05,
      createdAt: 1,
      updatedAt: 1,
      exchangeOrderId: "1",
      fillIds: ["tp1"],
      lastError: null,
      exchangeTerminalStatus: "CANCELED",
      fillReconcileCompletedAt: 1_700_000_000_000,
      lotStepSize: 0.00001,
    }]);
    listTradeLedger.mockResolvedValue([
      {
        symbol: "BTCUSDT", fillId: "tp1", qty: 0.05, side: "BUY", sellKind: "take_profit",
        orderId: "1", time: 1, price: 1, quoteQty: 1, commission: 0, commissionAsset: "USDT",
        commissionUsdt: 0, id: "a", realizedPnlUsdt: null,
      },
      {
        symbol: "BTCUSDT", fillId: "tp1", qty: 0.05, side: "SELL", sellKind: "take_profit",
        orderId: "1", time: 1, price: 1, quoteQty: 1, commission: 0, commissionAsset: "USDT",
        commissionUsdt: 0, id: "b", realizedPnlUsdt: null,
      },
    ]);
    const result = await enqueueEligibleSellSignals(data(["BTC", "ETH"]));
    expect(result.blocked.some((b) => b.symbol === "BTC")).toBe(true);
    const btcOk = reserveSellEvent.mock.calls.some((c) => (c[0] as { symbol?: string }).symbol === "BTC");
    expect(btcOk).toBe(false);
  });
});
