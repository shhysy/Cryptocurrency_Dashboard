import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { getDashboard } from "@/lib/service";
import { binanceReconcileAdapter } from "@/lib/execution/binance-reconcile.server";

vi.mock("@/lib/service", () => ({ getDashboard: vi.fn() }));
vi.mock("@/lib/execution/binance-reconcile.server", () => ({
  binanceReconcileAdapter: {
    getAccountBalances: vi.fn(),
    getSymbolRules: vi.fn(),
  },
}));

const getDashboardMock = vi.mocked(getDashboard);
const balancesMock = vi.mocked(binanceReconcileAdapter.getAccountBalances);
const rulesMock = vi.mocked(binanceReconcileAdapter.getSymbolRules);

function bindExecutionAccount(stub: { fetch: ReturnType<typeof vi.fn> } | null) {
  const g = globalThis as { EXECUTION_ACCOUNT?: { idFromName: () => string; get: () => unknown } };
  if (!stub) {
    delete g.EXECUTION_ACCOUNT;
    return;
  }
  g.EXECUTION_ACCOUNT = { idFromName: () => "id", get: () => stub };
}

function makeRequest(body = "") {
  return new Request("https://dashboard.example/api/execution/intents", {
    method: "POST",
    headers: {
      origin: "https://dashboard.example",
      authorization: `Basic ${btoa("user:test-password")}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body,
  });
}

function dashboard(overrides: Record<string, unknown> = {}) {
  return {
    source: "binance",
    updatedAt: Date.now(),
    stale: false,
    market: { accountKnown: true },
    coins: [{
      symbol: "BTC",
      signal: {
        action: { side: "buy", kind: "head", usdt: 100, qty: 0.001, blocked: [] },
      },
    }],
    ...overrides,
  } as never;
}

describe("Testnet服务端策略意图入口", () => {
  afterEach(() => {
    bindExecutionAccount(null);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    bindExecutionAccount(null);
    process.env.DASHBOARD_PASSWORD = "test-password";
    process.env.BINANCE_SPOT_ENVIRONMENT = "testnet";
    process.env.BINANCE_TESTNET_INTENT_CREATION_ENABLED = "1";
    process.env.BINANCE_TESTNET_BUY_ENABLED = "1";
    process.env.BINANCE_TESTNET_SELL_ENABLED = "1";
    getDashboardMock.mockResolvedValue(dashboard());
    balancesMock.mockResolvedValue([{ asset: "USDT", free: "1000", locked: "0" }] as never);
    rulesMock.mockResolvedValue({
      symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT",
      quoteOrderQtyMarketAllowed: true,
      filters: [
        { filterType: "LOT_SIZE", minQty: "0.00001", maxQty: "100", stepSize: "0.00001" },
        { filterType: "PRICE_FILTER", minPrice: "0.01", maxPrice: "1000000", tickSize: "0.01" },
        { filterType: "MIN_NOTIONAL", minNotional: "5", applyToMarket: true },
      ],
    } as never);
  });

  it("本地未绑定执行账户时返回 503，不提交订单", async () => {
    const response = await POST(makeRequest("{}"));
    const body = await response.json() as { local?: boolean };
    expect(response.status).toBe(503);
    expect(body.local).toBe(true);
  });

  it("绑定执行账户后只创建 intent，不提交订单", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const stub = {
      fetch: vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        calls.push(body);
        return Response.json({
          accepted: true, created: true, intentId: body.intentId, state: "queued",
        }, { status: 201 });
      }),
    };
    bindExecutionAccount(stub);

    const response = await POST(makeRequest("{}"));
    const body = await response.json() as { created: number; orderSubmitted: boolean };
    expect(response.status).toBe(200);
    expect(body.created).toBe(1);
    expect(body.orderSubmitted).toBe(false);
    expect(calls[0]).toMatchObject({
      strategyVersion: "3.3", symbol: "BTCUSDT", side: "BUY", quoteAsset: "USDT", amount: "100",
    });
  });

  it("拒绝Mock、STALE或过期行情", async () => {
    const stub = { fetch: vi.fn() };
    bindExecutionAccount(stub);
    getDashboardMock.mockResolvedValue(dashboard({ source: "mock" }));
    const response = await POST(makeRequest("{}"));
    expect(response.status).toBe(409);
    expect(stub.fetch).not.toHaveBeenCalled();
  });
});
