import { describe, expect, it, vi } from "vitest";
import type { DashboardData } from "@/lib/types";
import type { SellEventRecord } from "../sell-store.browser";
import type { LocalExecutionStore } from "./store";
import type { createBinanceReconcileAdapter, BinanceOrderLookup, BinanceTradePageResult } from "../binance-reconcile.server";
import type { SpotMarketOrderInput } from "@/lib/binance";
type Adapter = ReturnType<typeof createBinanceReconcileAdapter>;
import { runServerSellCycle } from "./sell-execution";

function fixture() {
  let continuation: SellEventRecord | null = null;
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
      listSellEvents: vi.fn(async () => [
        { ...event },
        ...(continuation ? [{ ...continuation }] : []),
      ]),
      claimSellEventForSubmission: vi.fn(async (key: string, clientOrderId: string) => {
        if (key === event.eventKey) {
          event = { ...event, status: "reconcile_required", clientOrderId, lastError: "待只读对账" };
          return { ...event };
        }
        if (continuation?.eventKey === key) {
          continuation = { ...continuation, status: "reconcile_required", clientOrderId, lastError: "待只读对账" };
          return { ...continuation };
        }
        throw new Error("测试夹具找不到SELL事件");
      }),
      bindSellEventToExchangeOrder: vi.fn(async (key: string, orderId: string) => {
        if (key === event.eventKey) {
          event = { ...event, exchangeOrderId: orderId };
          return { ...event };
        }
        if (continuation?.eventKey === key) {
          continuation = { ...continuation, exchangeOrderId: orderId };
          return { ...continuation };
        }
        throw new Error("测试夹具找不到SELL事件");
      }),
      updateSellEvent: vi.fn(async (next: SellEventRecord) => {
        if (next.eventKey === event.eventKey) event = { ...next };
        else if (continuation?.eventKey === next.eventKey) continuation = { ...next };
        else throw new Error("测试夹具找不到SELL事件");
      }),
      reserveSellEvent: vi.fn(async (record: SellEventRecord) => {
        if (record.eventKey === event.eventKey) return { record: { ...event }, created: false };
        if (continuation?.eventKey === record.eventKey) return { record: { ...continuation }, created: false };
        continuation = { ...record };
        return { record: { ...continuation }, created: true };
      }),
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

  return {
    store, adapter, dashboard, findOrderByClientOrderId, listOrderTrades,
    getEvent: () => event,
    getEvents: () => [{ ...event }, ...(continuation ? [{ ...continuation }] : [])],
    setEvent: (next: Partial<SellEventRecord>) => { event = { ...event, ...next }; },
    setContinuation: (next: SellEventRecord) => { continuation = { ...next }; },
  };
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
    f.setContinuation({
      ...f.getEvent(),
      eventKey: "sell:ETH:take_profit:1800000000000:止盈1",
      symbol: "ETH",
      status: "pending",
      requestedQty: 0.1,
      filledQty: 0,
      exchangeOrderId: null,
      clientOrderId: undefined,
      fillIds: [],
    });

    const second = await runServerSellCycle(deps);
    expect(second.skipped).toBe(1);
    expect(f.findOrderByClientOrderId).toHaveBeenCalledWith("BTCUSDT", originalClientOrderId);
    expect(f.store.sellEvents.claimSellEventForSubmission).toHaveBeenCalledTimes(1);
    expect(submitOrder).toHaveBeenCalledTimes(1);
    expect(f.getEvent().clientOrderId).toBe(originalClientOrderId);
  });

  it("SELL终态部分成交后为剩余数量创建唯一续卖事件，不重发原订单", async () => {
    const f = fixture();
    f.setEvent({ status: "reconcile_required", clientOrderId: "gpt-partial-sell-1" });
    f.findOrderByClientOrderId.mockResolvedValue({
      kind: "found",
      order: {
        symbol: "BTCUSDT",
        orderId: 124,
        clientOrderId: "gpt-partial-sell-1",
        side: "SELL",
        status: "CANCELED",
        origQty: "0.2",
        executedQty: "0.1",
        cummulativeQuoteQty: "10",
        time: 1_800_000_000_000,
        updateTime: 1_800_000_000_001,
      },
    });
    f.listOrderTrades.mockResolvedValue({
      complete: true,
      pagesRead: 1,
      trades: [{
        id: 457,
        orderId: 124,
        symbol: "BTCUSDT",
        side: "SELL",
        price: "100",
        qty: "0.1",
        quoteQty: "10",
        commission: "0",
        commissionAsset: "USDT",
        time: 1_800_000_000_001,
      }],
    });
    const submitOrder = vi.fn();
    const result = await runServerSellCycle({
      mode: "off",
      store: f.store,
      adapter: f.adapter,
      dashboard: null,
      submitOrder,
      now: () => 1_800_000_000_002,
    });

    expect(result.reconciled).toBe(1);
    expect(f.getEvent()).toMatchObject({ status: "partially_filled", filledQty: 0.1 });
    const children = f.getEvents().filter((item) => item.eventKey.includes(":续卖"));
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({
      symbol: "BTC",
      kind: "take_profit",
      status: "pending",
      requestedQty: 0.1,
      filledQty: 0,
    });
    expect(submitOrder).not.toHaveBeenCalled();
    expect(f.store.sellEvents.reserveSellEvent).toHaveBeenCalledTimes(1);

    // 同一终态父事件再次对账时，不得重复创建第二个续卖事件；新子事件使用独立clientOrderId提交。
    const originalClientOrderId = f.getEvent().clientOrderId;
    const continuationSubmit = vi.fn(async (input: SpotMarketOrderInput) => ({
      symbol: input.symbol,
      orderId: 125,
      clientOrderId: input.clientOrderId,
      status: "NEW" as const,
      origQty: input.amount,
      executedQty: "0",
      cummulativeQuoteQty: "0",
      transactTime: 1_800_000_000_004,
    }));
    const resumed = await runServerSellCycle({
      mode: "testnet",
      store: f.store,
      adapter: f.adapter,
      dashboard: f.dashboard,
      submitOrder: continuationSubmit,
      now: () => 1_800_000_000_004,
    });
    expect(resumed.submitted).toBe(1);
    expect(f.getEvents().filter((item) => item.eventKey.includes(":续卖"))).toHaveLength(1);
    expect(f.store.sellEvents.reserveSellEvent).toHaveBeenCalledTimes(1);
    expect(continuationSubmit).toHaveBeenCalledWith(expect.objectContaining({
      side: "SELL",
      symbol: "BTCUSDT",
      amount: "0.1",
    }));
    const child = f.getEvents().find((item) => item.eventKey.includes(":续卖"));
    expect(child?.clientOrderId).toBeTruthy();
    expect(child?.clientOrderId).not.toBe(originalClientOrderId);
    expect(child?.exchangeOrderId).toBe("125");
  });

  it("预检可执行数量比策略授权数量少至少一个交易步长时拒绝静默缩量", async () => {
    const f = fixture();
    const ledger = await f.store.tradeLedger.listTradeLedger();
    vi.mocked(f.store.tradeLedger.listTradeLedger).mockResolvedValue([{
      ...ledger[0],
      qty: 0.2,
      quoteQty: 20,
      baseRatioAtBuy: 0.4,
    }]);
    vi.mocked(f.adapter.getAccountBalances).mockResolvedValue([
      { asset: "BTC", free: "0.12", locked: "0.08" },
      { asset: "USDT", free: "100", locked: "0" },
    ] as never);
    const submitOrder = vi.fn();
    const result = await runServerSellCycle({
      mode: "testnet",
      store: f.store,
      adapter: f.adapter,
      dashboard: f.dashboard,
      submitOrder,
      now: () => 1_800_000_000_002,
    });
    expect(result.blocked).toBe(1);
    expect(f.getEvent().status).toBe("blocked");
    expect(f.getEvent().lastError).toContain("拒绝静默缩量");
    expect(submitOrder).not.toHaveBeenCalled();
  });

  it("同一SELL节拍最多提交一笔订单，其余pending事件留待下一轮", async () => {
    const f = fixture();
    f.setContinuation({
      ...f.getEvent(),
      eventKey: `${f.getEvent().eventKey}:续卖1`,
      status: "pending",
      requestedQty: 0.1,
      filledQty: 0,
      exchangeOrderId: null,
      clientOrderId: undefined,
      fillIds: [],
    });
    const submitOrder = vi.fn(async (input: SpotMarketOrderInput) => ({
      symbol: input.symbol,
      orderId: 126,
      clientOrderId: input.clientOrderId,
      status: "NEW" as const,
      origQty: input.amount,
      executedQty: "0",
      cummulativeQuoteQty: "0",
      transactTime: 1_800_000_000_003,
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
    expect(f.store.sellEvents.claimSellEventForSubmission).toHaveBeenCalledTimes(1);
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

    // 旧订单本轮已成功只读恢复，不计入 skipped；只有新卖单因 STALE 被跳过。
    expect(result.skipped).toBe(1);
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
    const bindOrderCall = vi.mocked(f.store.sellEvents.bindSellEventToExchangeOrder).mock.invocationCallOrder[0];
    const ledgerWriteCall = vi.mocked(f.store.tradeLedger.recordConfirmedSellFill).mock.invocationCallOrder[0];
    expect(bindOrderCall).toBeLessThan(ledgerWriteCall);
    expect(f.getEvent()).toMatchObject({
      status: "executed",
      exchangeOrderId: "123",
      fillIds: ["456"],
      exchangeTerminalStatus: "FILLED",
    });
  });

});
