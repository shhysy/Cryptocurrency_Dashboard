import { describe, expect, it } from "vitest";
import { applyPostTakeProfitRebuy } from "./post-take-profit-rebuy";
import type { DashboardData, CoinCard } from "../lib/types";
import type { SellEventRecord } from "../lib/execution/sell-store.browser";
import type { TradeLedgerEntry } from "../lib/execution/types";

const coin: CoinCard = {
  symbol: "BTC", name: "Bitcoin", color: "#f7931a", price: 80, change24h: 0,
  qty: 0.8, marketValue: 64, avgCost: 100, invested: 100, returnPct: -0.2,
  toDoublePct: 1.5, doubleProgress: 0,
  series: [],
  buys: [{ id: "buy-1", t: 1, price: 100, qty: 1, costUsdt: 100, position: "mid" }],
  signal: {
    symbol: "BTC", group: "core", kind: "none", tag: "观望", score: 100,
    breakdown: { pricePosition: 45, sentiment: 30, trend: 15, rsi: 30, ma: 30 },
    reasons: [],
    action: { kind: "add", label: "补仓1", side: "none", plannedUsdt: null, usdt: null, qty: null, sellPct: null, limits: [], blocked: [], notes: [] },
    metrics: { weeklyRsi: 30, ma200: 100, fearGreed: 10, stableCount: 3, stabilized: true, stableItems: [true, true, true], btcState: "bull", returnPct: -0.2 },
  },
};

const data = (over: Partial<DashboardData> = {}): DashboardData => ({
  source: "binance", updatedAt: 100 * 7 * 864e5, stale: false, staleReasons: [], notes: [],
  account: { assets: [], cashUsdt: 1000 },
  summary: { totalAssets: 1064, totalValue: 64, totalInvested: 100, pnl: -36, pnlPct: -0.36, investedCny: 710, usdtCny: 7.1 },
  equityCurve: [], allocation: [], coins: [coin], trades: [],
  verdict: { kind: "none", primary: null, others: [], reasons: [] },
  market: { fearGreed: 10, btcState: "bull", accountKnown: true },
  config: { doubleLine: 1, mailScoreCore: 55, mailScoreAlt: 75 },
  ...over,
});

const event: SellEventRecord = {
  eventKey: "sell:BTC:take_profit:10:止盈1", symbol: "BTC", kind: "take_profit",
  status: "executed", requestedQty: 0.2, filledQty: 0.2, createdAt: 10, updatedAt: 20,
  exchangeOrderId: "11", fillIds: ["sell-1"], lastError: null,
};
const sell: TradeLedgerEntry = {
  id: "BTCUSDT:sell-1", fillId: "sell-1", orderId: "11", symbol: "BTCUSDT",
  side: "SELL", time: 10, price: 150, qty: 0.2, quoteQty: 30,
  commission: 0, commissionAsset: "USDT", commissionUsdt: 0,
  realizedPnlUsdt: 10, sellKind: "take_profit",
};

describe("post-take-profit average-cost rebuy", () => {
  it("replaces the head-price ladder with the first average-cost tier after a confirmed TP", () => {
    const result = applyPostTakeProfitRebuy(data(), [event], [sell]);
    expect(result.coins[0].signal.action.label).toBe("均价回补第 1 档");
    expect(result.coins[0].signal.action.side).toBe("buy");
    expect(result.coins[0].signal.action.qty).toBeGreaterThan(0);
  });

  it("uses the remaining position average cost and checks the new drawdown trigger", () => {
    const result = applyPostTakeProfitRebuy(data({ coins: [{ ...coin, price: 90 }] }), [event], [sell]);
    expect(result.coins[0].avgCost).toBeCloseTo(100);
    expect(result.coins[0].signal.action.side).toBe("none");
    expect(result.coins[0].signal.action.notes[0]).toContain("下跌 15%");
  });

  it("SELL成交已写入SQLite但事件fillIds尚未更新时必须阻断回补", () => {
    const interrupted = {
      ...event,
      status: "reconcile_required" as const,
      exchangeOrderId: "11",
      fillIds: [],
      filledQty: 0,
    };
    const result = applyPostTakeProfitRebuy(data(), [interrupted], [sell]);
    expect(result.coins[0].signal.tag).toBe("暂缓");
    expect(result.coins[0].signal.action.blocked.join()).toContain("索引与SQLite确认成交不一致");
  });

  it("SELL事件仍在对账状态但订单身份和全部成交索引已持久化时可进入均价回补", () => {
    const interrupted = {
      ...event,
      status: "reconcile_required" as const,
      exchangeOrderId: "11",
      fillIds: ["sell-1"],
    };
    const result = applyPostTakeProfitRebuy(data(), [interrupted], [sell]);
    expect(result.coins[0].signal.action.label).toBe("均价回补第 1 档");
    expect(result.coins[0].signal.action.side).toBe("buy");
  });

  it("does not switch modes for a pending or unfilled take-profit event", () => {
    const pending = { ...event, status: "pending" as const, filledQty: 0 };
    const result = applyPostTakeProfitRebuy(data(), [pending], [sell]);
    expect(result.coins[0].signal.action.label).not.toContain("均价回补");
  });

  it("fails closed if the confirmed take-profit fill is missing from the ledger", () => {
    const result = applyPostTakeProfitRebuy(data(), [event], []);
    expect(result.coins[0].signal.tag).toBe("暂缓");
    expect(result.coins[0].signal.action.blocked.join()).toContain("明细不完整");
  });

  it("does not apply the post-TP ladder after the position is fully closed", () => {
    const result = applyPostTakeProfitRebuy(data({ coins: [{ ...coin, qty: 0, avgCost: null }] }), [event], [sell]);
    expect(result.coins[0].signal.action.label).not.toContain("均价回补");
  });
});


describe("sequential take-profit tiers", () => {
  it("sells 50% of the current cycle inventory at 2x", () => {
    const d = data({ coins: [{ ...coin, price: 200, qty: 0.8, marketValue: 160 }] });
    const priorSell: TradeLedgerEntry = { ...sell, fillId: "prior-sell", time: 5, qty: 0.2, quoteQty: 20, sellKind: "trail_stop" };
    const result = applyPostTakeProfitRebuy(d, [], [priorSell]);
    expect(result.coins[0].signal.action.label).toBe("止盈1");
    expect(result.coins[0].signal.action.qty).toBeCloseTo(0.3, 10);
  });

  it("does not skip the 3x tier when price jumps directly to 5x", () => {
    const d = data({ coins: [{ ...coin, price: 500, qty: 0.8, marketValue: 400 }] });
    const result = applyPostTakeProfitRebuy(d, [event], [sell]);
    expect(result.coins[0].signal.action.label).toBe("止盈2");
    expect(result.coins[0].signal.action.qty).toBeCloseTo(0.18, 10);
  });

  it("does not reactivate post-TP rebuys after the previous round went flat", () => {
    const flatSell: TradeLedgerEntry = {
      ...sell, fillId: "sell-flat", time: 30, qty: 0.8, quoteQty: 120,
      sellKind: "trail_stop",
    };
    const freshBuy: CoinCard["buys"][number] = {
      id: "fresh-buy", t: 40, price: 90, qty: 1, costUsdt: 90, position: "mid",
    };
    const d = data({ coins: [{ ...coin, price: 80, qty: 1, marketValue: 80, buys: [...coin.buys, freshBuy] }] });
    const result = applyPostTakeProfitRebuy(d, [event], [sell, flatSell]);
    expect(result.coins[0].signal.action.label).not.toContain("均价回补");
  });
});


  it("restarts take-profit at tier 1 after a flat-and-reopen round", () => {
    const flatSell: TradeLedgerEntry = {
      ...sell, fillId: "sell-flat-round", time: 30, qty: 0.8, quoteQty: 120,
      sellKind: "trail_stop",
    };
    const freshBuy: CoinCard["buys"][number] = {
      id: "fresh-round-buy", t: 40, price: 90, qty: 1, costUsdt: 90, position: "mid",
    };
    const d = data({ coins: [{ ...coin, price: 200, qty: 1, marketValue: 200, buys: [...coin.buys, freshBuy] }] });
    const result = applyPostTakeProfitRebuy(d, [event], [sell, flatSell]);
    expect(result.coins[0].signal.action.label).toBe("止盈1");
    expect(result.coins[0].signal.action.qty).toBeCloseTo(0.3, 10);
  });


  it("blocks strategy actions when buy history cannot reconcile the current balance", () => {
    const d = data({ coins: [{ ...coin, qty: 0.5, marketValue: 40 }] });
    const result = applyPostTakeProfitRebuy(d, [], []);
    expect(result.coins[0].signal.tag).toBe("暂缓");
    expect(result.coins[0].signal.action.blocked.join()).toContain("无法核对");
  });
