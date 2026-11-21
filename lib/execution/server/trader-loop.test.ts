import { describe, expect, it, vi } from "vitest";
import type { DashboardData } from "@/lib/types";
import type { ServerExecutionIntent } from "../server-execution-core";
import type { LocalExecutionStore } from "./store";
import {
  buildServerBuyIntents,
  runTraderCycle,
  type TraderCycleDependencies,
} from "./trader-loop";

function dashboard(overrides: Record<string, unknown> = {}): DashboardData {
  return {
    source: "binance",
    updatedAt: 1_800_000_000_000,
    stale: false,
    market: { accountKnown: true },
    coins: [{
      symbol: "BTC",
      price: 60_000,
      series: [{ t: 1_700_000_000_000 }, { t: 1_800_000_000_000 }],
      signal: {
        action: { side: "buy", kind: "head", label: "首仓", usdt: 100, blocked: [] },
      },
    }],
    ...overrides,
  } as unknown as DashboardData;
}

function mockStore(overrides: Record<string, unknown> = {}): LocalExecutionStore {
  return {
    createIntent: vi.fn(async (intent: ServerExecutionIntent) => ({ intent, created: true })),
    getIntent: vi.fn(async () => null),
    listRunnableIntents: vi.fn(async () => []),
    claimIntent: vi.fn(async () => null),
    renewExecutionLease: vi.fn(async () => true),
    markSubmitting: vi.fn(async () => ({} as ServerExecutionIntent)),
    markUnknown: vi.fn(async () => ({} as ServerExecutionIntent)),
    takeoverForReconciliation: vi.fn(async () => null),
    getReconcileContext: vi.fn(async () => null),
    finalizeReconciledOrder: vi.fn(async () => ({} as ServerExecutionIntent)),
    markManualReview: vi.fn(async () => undefined),
    close: vi.fn(),
    scheduler: {
      enqueue: vi.fn(async () => ({ created: true })),
      claimDue: vi.fn(async () => []),
      renew: vi.fn(async () => true),
      ack: vi.fn(async () => true),
      retry: vi.fn(async () => "pending" as const),
      recoverExpired: vi.fn(async () => 0),
    },
    sellEvents: {
      reserveSellEvent: vi.fn(),
      updateSellEvent: vi.fn(),
      listSellEvents: vi.fn(),
      claimSellEventForSubmission: vi.fn(),
      bindSellEventToExchangeOrder: vi.fn(),
    },
    tradeLedger: {
      listTradeLedger: vi.fn(async () => []),
      recordConfirmedSellFill: vi.fn(),
    },
    ...overrides,
  } as unknown as LocalExecutionStore;
}

describe("本地Trader策略信号与执行循环", () => {
  it("仅将新鲜、非阻断的策略3.3 BUY信号转成幂等intent并冻结baseRatio", () => {
    const intents = buildServerBuyIntents(dashboard());
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      intentId: "v33:BTC:head:1700000000000",
      strategyVersion: "3.3",
      symbol: "BTCUSDT",
      side: "BUY",
      amount: "100",
      baseRatioAtSignal: 0.4,
      state: "queued",
      attempt: 0,
    });
  });

  it("按用户确认允许BTC、PAXG、ETH、BNB、UNI生成BUY intent，未知及signal-only资产仍拒绝", () => {
    const make = (symbol: string) => dashboard({
      coins: [{
        symbol, price: 100, series: [{ t: 1_700_000_000_000 }, { t: 1_800_000_000_000 }],
        signal: { action: { side: "buy", kind: "head", usdt: 100, blocked: [] } },
      }],
    });
    for (const symbol of ["BTC", "PAXG", "ETH", "BNB", "UNI"]) {
      expect(buildServerBuyIntents(make(symbol))).toHaveLength(1);
    }
    expect(buildServerBuyIntents(make("UNKNOWN"))).toHaveLength(0);
    expect(buildServerBuyIntents(make("CL"))).toHaveLength(0);
  });

  it("STALE仅作软提示；Mock、未知账户或策略阻断时不生成intent", () => {
    expect(buildServerBuyIntents(dashboard({ stale: true }))).toHaveLength(1);
    expect(buildServerBuyIntents(dashboard({ source: "mock" }))).toHaveLength(0);
    expect(buildServerBuyIntents(dashboard({ market: { accountKnown: false } }))).toHaveLength(0);
    const blocked = dashboard({
      coins: [{
        symbol: "BTC", price: 60_000, series: [{ t: 1 }, { t: 2 }],
        signal: { action: { side: "buy", kind: "head", usdt: 100, blocked: ["STALE"] } },
      }],
    });
    expect(buildServerBuyIntents(blocked)).toHaveLength(0);
  });

  it("dry-run只创建intent，不领取资金、不提交订单", async () => {
    const store = mockStore();
    const submitOrder = vi.fn();
    const deps: TraderCycleDependencies = {
      mode: "dry-run",
      store,
      getDashboard: async () => dashboard(),
      adapter: {
        getAccountBalances: vi.fn(async () => [{ asset: "USDT", free: "1000", locked: "0" }]),
      } as never,
      submitOrder,
      now: () => 1_800_000_000_100,
    };
    const result = await runTraderCycle(deps);
    expect(result.signalsCreated).toBe(1);
    expect(store.createIntent).toHaveBeenCalledTimes(1);
    expect(store.scheduler.recoverExpired).toHaveBeenCalledWith(1_800_000_000_100);
    expect(store.claimIntent).not.toHaveBeenCalled();
    expect(submitOrder).not.toHaveBeenCalled();
  });

  it("Testnet POST结果不明时持久化unknown并保留原clientOrderId，绝不盲目重发", async () => {
    const value: ServerExecutionIntent = {
      intentId: "v33:BTC:head:1700000000000",
      strategyEventId: "BTC:head:首仓:1700000000000",
      strategyVersion: "3.3",
      symbol: "BTCUSDT",
      side: "BUY",
      quoteAsset: "USDT",
      amount: "100",
      baseRatioAtSignal: 0.4,
      state: "reserved",
      attempt: 1,
      createdAt: 1_800_000_000_000,
      updatedAt: 1_800_000_000_100,
      exchangeOrderId: null,
      clientOrderId: "gpt-client-123",
      exchangeTerminalAt: null,
      fillsReconciledAt: null,
      lastError: null,
    };
    const store = mockStore({
      listRunnableIntents: vi.fn(async () => [{ ...value, state: "queued", attempt: 0, clientOrderId: null }]),
      claimIntent: vi.fn(async () => ({
        intent: value,
        lease: { intentId: value.intentId, attempt: 1, token: "account-lease-token", leaseUntil: 1_800_000_030_100 },
        reservationId: "r1",
        reservedAsset: "USDT",
        reservedAmount: "100",
      })),
    });
    const submitOrder = vi.fn(async () => {
      throw new Error("socket timeout after POST; exchange response unknown");
    });
    const deps: TraderCycleDependencies = {
      mode: "testnet",
      store,
      getDashboard: async () => dashboard(),
      adapter: {
        getAccountBalances: vi.fn(async () => [{ asset: "USDT", free: "1000", locked: "0" }]),
      } as never,
      submitOrder,
      now: () => 1_800_000_000_100,
    };
    const result = await runTraderCycle(deps);
    expect(result.unknown).toBe(1);
    expect(submitOrder).toHaveBeenCalledTimes(1);
    expect(submitOrder).toHaveBeenCalledWith({
      side: "BUY", symbol: "BTCUSDT", amount: "100", clientOrderId: "gpt-client-123",
    });
    expect(store.markSubmitting).toHaveBeenCalledTimes(1);
    expect(store.markUnknown).toHaveBeenCalledWith(expect.objectContaining({
      intentId: value.intentId,
      attempt: 1,
      leaseToken: "account-lease-token",
    }));
  });

  it("对账进入人工复核时立即禁止生成新BUY信号", async () => {
    const getDashboard = vi.fn(async () => dashboard());
    const store = mockStore({
      getReconcileContext: vi.fn(async () => ({
        intent: {
          intentId: "review-intent",
          strategyEventId: "BTC:head:review",
          strategyVersion: "3.3",
          symbol: "BTCUSDT",
          side: "BUY",
          quoteAsset: "USDT",
          amount: "100",
          state: "unknown",
          attempt: 1,
          createdAt: 1_800_000_000_000,
          updatedAt: 1_800_000_000_000,
          exchangeOrderId: null,
          clientOrderId: null,
          exchangeTerminalAt: null,
          fillsReconciledAt: null,
          lastError: null,
        } as ServerExecutionIntent,
        lease: null,
        reservedAsset: null,
        reservedAmount: null,
      })),
      scheduler: {
        enqueue: vi.fn(async () => ({ created: true })),
        claimDue: vi.fn(async () => [{
          taskId: "reconcile:review-intent",
          taskType: "reconcile_intent" as const,
          dueAt: 1_800_000_000_000,
          attempt: 1,
          leaseToken: "scheduler-lease",
          leaseUntil: 1_800_000_030_000,
        }]),
        renew: vi.fn(async () => true),
        ack: vi.fn(async () => true),
        retry: vi.fn(async () => "manual_review" as const),
        recoverExpired: vi.fn(async () => 0),
      },
    });
    const result = await runTraderCycle({
      mode: "testnet",
      store,
      getDashboard,
      adapter: {} as never,
      submitOrder: vi.fn(),
      now: () => 1_800_000_000_100,
    });
    expect(result.manualReview).toBe(1);
    expect(result.skippedReason).toContain("人工复核");
    expect(getDashboard).not.toHaveBeenCalled();
    expect(store.createIntent).not.toHaveBeenCalled();
  });

  it("拒绝生产模式，直到独立生产预检与授权任务完成", async () => {
    const deps: TraderCycleDependencies = {
      mode: "production",
      store: mockStore(),
      getDashboard: async () => dashboard(),
      adapter: {} as never,
      submitOrder: vi.fn(),
    };
    await expect(runTraderCycle(deps)).rejects.toThrow("尚未完成M3-01");
  });
});
