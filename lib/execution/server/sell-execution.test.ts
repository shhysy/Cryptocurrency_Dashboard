import { describe, expect, it, vi } from "vitest";
import type { DashboardData } from "@/lib/types";
import type { SellEventRecord } from "../sell-store.browser";
import type { LocalExecutionStore } from "./store";
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

  const adapter = {
    findOrderByClientOrderId: vi.fn(async () => ({ kind: "not_found" as const })),
    listOrderTrades: vi.fn(async () => ({ trades: [], complete: true, pagesRead: 1 })),
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
  } as never;

  const dashboard = {
    source: "binance",
    stale: false,
    market: { accountKnown: true },
    coins: [{ symbol: "BTC", price: 100 }],
  } as unknown as DashboardData;

  return { store, adapter, dashboard, getEvent: () => event };
}

describe("本地Trader服务端SELL执行", () => {
  it("在SQLite事件领取后提交一次SELL，并持久化原clientOrderId", async () => {
    const f = fixture();
    const submitOrder = vi.fn(async (input) => ({
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
    expect(f.adapter.findOrderByClientOrderId).toHaveBeenCalledWith("BTCUSDT", originalClientOrderId);
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
});
