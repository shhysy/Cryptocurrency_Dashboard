import { describe, expect, it, vi } from "vitest";
import type { DashboardData } from "@/lib/types";
import type { SellEventRecord } from "../sell-store.browser";
import type { LocalExecutionStore } from "./store";
import type { createBinanceReconcileAdapter, BinanceOrderLookup, BinanceTradePageResult } from "../binance-reconcile.server";
import type { SpotMarketOrderInput } from "@/lib/binance";
type Adapter = ReturnType<typeof createBinanceReconcileAdapter>;
import { runServerSellCycle } from "./sell-execution";

function fixture() {
  let event: SellEventRecord = {
    eventKey: "sell:BTC:take_profit:1800000000000:止盈1",
    symbol: "BTC",
    kind: "take_profit",
    status: "pending",
    requestedQty: 0.2,
    createdAt: 1_800_000_000_000,
    updatedAt: 1_800_000_000_000,
    exchangeOrderId: null,
    fillIds: [],
    lastError: null,
  };
  const store = {
    sellEvents: {
      listSellEvents: vi.fn(async () => [{ ...event }]),
      claimSellEventForSubmission: vi.fn(async (_key: string, clientOrderId: string) => {
        event = { ...event, status: "reconcile_required", clientOrderId, lastError: "待只读对账" };
        return { ...event };
      }),
      bindSellEventToExchangeOrder: vi.fn(async (_key: string, orderId: string) => {
        event = { ...event, exchangeOrderId: orderId };
        return { ...event };
      }),
      updateSellEvent: vi.fn(async (next: SellEventRecord) => { event = { ...next }; }),
      reserveSellEvent: vi.fn(),
    },
    tradeLedger: {
      listTradeLedger: vi.fn(async () => [{
        id: "BTCUSDT:buy-1",
        fillId: "buy-1",
        orderId: "1",
        symbol: "BTCUSDT",
        side: "BUY" as const,
        time: 1_700_000_000_000,
        price: 100,
        qty: 1,
        quoteQty: 100,
        commission: 0,
        commissionAsset: "USDT",
        commissionUsdt: 0,
        realizedPnlUsdt: null,
        baseRatioAtBuy: 0.4,
      }]),
      recordConfirmedSellFill: vi.fn(),
    },
  } as unknown as LocalExecutionStore;

  const findOrderByClientOrderId = vi.fn<(...args: [string, string]) => Promise<BinanceOrderLookup>>(async () => ({ kind: "not_found" }));
  const listOrderTrades = vi.fn<(...args: [string, number]) => Promise<BinanceTradePageResult>>(async () => ({ trades: [], complete: true, pagesRead: 1 }));
  const adapter = {
    findOrderByClientOrderId,
    listOrderTrades,
    getAccountBalances: vi.fn(async () => [
      { asset: "BTC", free: "1", locked: "0" },
    ]),
    getSymbolRules: vi.fn(async () => ({
      symbol: "BTCUSDT",
      status: "TRADING",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      quoteOrderQtyMarketAllowed: true,
      filters: [
        { filterType: "MARKET_LOT_SIZE", minQty: "0.001", maxQty: "100", stepSize: "0.001" },
        { filterType: "MIN_NOTIONAL", minNotional: "10", applyToMarket: true },
      ],
    })),
  } as unknown as Adapter;

  const dashboard = {
    source: "binance",
    stale: false,
    market: { accountKnown: true },
    coins: [{ symbol: "BTC", price: 100 }],
  } as unknown as DashboardData;

  return { store, adapter, dashboard, findOrderByClientOrderId, listOrderTrades, getEvent: () => event, setEvent: (next: Partial<SellEventRecord>) => { event = { ...event, ...next }; } };
}

describe("本地Trader服务端SELL执行", () => {
  it("在SQLite事件领取后提交一次SELL，并持久化原clientOrderId", async () => {
    const f = fixture();
    const submitOrder = vi.fn(async (input: SpotMarketOrderInput) => ({
      symbol: input.symbol,
      orderId: 123,
      clientOrderId: input.clientOrderId,
      status: "NEW" as const,
      origQty: "0.2",
      executedQty: "0",
      cummulativeQuoteQty: "0",
      transactTime: 1_800_000_000_001,
    }));

    const result = await runServerSellCycle({
      mode: "testnet",
      store: f.store,
      adapter: f.adapter,
      dashboard: f.dashboard,
      submitOrder,
      now: () => 1_800_000_000_002,
    });

    expect(result.submitted).toBe(1);
    expect(submitOrder).toHaveBeenCalledTimes(1);
    expect(submitOrder).toHaveBeenCalledWith(expect.objectContaining({
      side: "SELL",
      symbol: "BTCUSDT",
      amount: "0.2",
    }));
    expect(f.store.sellEvents.claimSellEventForSubmission).toHaveBeenCalledTimes(1);
    expect(f.getEvent().status).toBe("reconcile_required");
    expect(f.getEvent().clientOrderId).toBeTruthy();
    expect(f.getEvent().exchangeOrderId).toBe("123");
  });

  it("SELL POST结果不明后只按原clientOrderId查单，绝不再次POST", async () => {
    const f = fixture();
    const submitOrder = vi.fn(async () => {
      throw new Error("socket timeout after request");
    });

    const deps = {
      mode: "testnet" as const,
      store: f.store,
      adapter: f.adapter,
      dashboard: f.dashboard,
      submitOrder,
      now: () => 1_800_000_000_002,
    };
    const first = await runServerSellCycle(deps);
    expect(first.unknown).toBe(1);
    expect(submitOrder).toHaveBeenCalledTimes(1);
    const originalClientOrderId = f.getEvent().clientOrderId;

    const second = await runServerSellCycle(deps);
    expect(second.skipped).toBe(1);
    expect(f.findOrderByClientOrderId).toHaveBeenCalledWith("BTCUSDT", originalClientOrderId);
    expect(submitOrder).toHaveBeenCalledTimes(1);
    expect(f.getEvent().clientOrderId).toBe(originalClientOrderId);
  });

  it("dry-run只读，不领取SELL事件也不发送订单", async () => {
    const f = fixture();
    const submitOrder = vi.fn();
    const result = await runServerSellCycle({
      mode: "dry-run",
      store: f.store,
      adapter: f.adapter,
      dashboard: f.dashboard,
      submitOrder,
    });
    expect(result.submitted).toBe(0);
    expect(f.store.sellEvents.claimSellEventForSubmission).not.toHaveBeenCalled();
    expect(submitOrder).not.toHaveBeenCalled();
  });

  it("data/STOP对应off模式仍恢复旧SELL订单，但不读取行情、不创建新订单", async () => {
    const f = fixture();
    f.setEvent({ status: "reconcile_required", clientOrderId: "gpt-stop-recovery-1" });
    const submitOrder = vi.fn();
    const result = await runServerSellCycle({
      mode: "off",
      store: f.store,
      adapter: f.adapter,
      dashboard: null,
      submitOrder,
    });

    expect(result.skipped).toBe(1);
    expect(f.findOrderByClientOrderId).toHaveBeenCalledWith("BTCUSDT", "gpt-stop-recovery-1");
    expect(f.store.sellEvents.claimSellEventForSubmission).not.toHaveBeenCalled();
    expect(submitOrder).not.toHaveBeenCalled();
  });

  it("行情STALE时仍先恢复旧SELL订单，再阻断新卖单", async () => {
    const f = fixture();
    f.setEvent({ status: "reconcile_required", clientOrderId: "gpt-stale-recovery-1" });
    const staleDashboard = { ...f.dashboard, stale: true } as DashboardData;
    const submitOrder = vi.fn();
    const result = await runServerSellCycle({
      mode: "testnet",
      store: f.store,
      adapter: f.adapter,
      dashboard: staleDashboard,
      submitOrder,
    });

    expect(result.skipped).toBe(2);
    expect(f.findOrderByClientOrderId).toHaveBeenCalledWith("BTCUSDT", "gpt-stale-recovery-1");
    expect(f.store.sellEvents.claimSellEventForSubmission).not.toHaveBeenCalled();
    expect(submitOrder).not.toHaveBeenCalled();
  });

  it("按原clientOrderId只读对账，逐笔成交一致后才写台账并结束SELL事件", async () => {
    const f = fixture();
    f.setEvent({ status: "reconcile_required", clientOrderId: "gpt-original-123" });
    f.findOrderByClientOrderId.mockResolvedValue({
      kind: "found",
      order: {
        symbol: "BTCUSDT",
        orderId: 123,
        clientOrderId: "gpt-original-123",
        side: "SELL",
        status: "FILLED",
        origQty: "0.2",
        executedQty: "0.2",
        cummulativeQuoteQty: "20",
        time: 1_800_000_000_000,
        updateTime: 1_800_000_000_001,
      },
    });
    f.listOrderTrades.mockResolvedValue({
      complete: true,
      pagesRead: 1,
      trades: [{
        id: 456,
        orderId: 123,
        symbol: "BTCUSDT",
        side: "SELL",
        price: "100",
        qty: "0.2",
        quoteQty: "20",
        commission: "0",
        commissionAsset: "USDT",
        time: 1_800_000_000_001,
      }],
    });

    const result = await runServerSellCycle({
      mode: "testnet",
      store: f.store,
      adapter: f.adapter,
      dashboard: f.dashboard,
      submitOrder: vi.fn(),
      now: () => 1_800_000_000_002,
    });

    expect(result.reconciled).toBe(1);
    expect(f.store.sellEvents.bindSellEventToExchangeOrder).toHaveBeenCalledWith(
      f.getEvent().eventKey,
      "123",
      1_800_000_000_002,
    );
    expect(f.store.tradeLedger.recordConfirmedSellFill).toHaveBeenCalledTimes(1);
    expect(f.getEvent()).toMatchObject({
      status: "executed",
      exchangeOrderId: "123",
      fillIds: ["456"],
      exchangeTerminalStatus: "FILLED",
    });
  });

});
