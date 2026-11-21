import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { getDashboard } from "@/lib/service";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { binanceReconcileAdapter } from "@/lib/execution/binance-reconcile.server";

vi.mock("@/lib/service", () => ({ getDashboard: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: vi.fn() }));
vi.mock("@/lib/execution/binance-reconcile.server", () => ({
  binanceReconcileAdapter: {
    getAccountBalances: vi.fn(),
    getSymbolRules: vi.fn(),
  },
}));

const getDashboardMock = vi.mocked(getDashboard);
const contextMock = vi.mocked(getCloudflareContext);
const balancesMock = vi.mocked(binanceReconcileAdapter.getAccountBalances);
const rulesMock = vi.mocked(binanceReconcileAdapter.getSymbolRules);

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
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("只用服务端重新计算的信号创建DO intent，不提交订单", async () => {
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
    contextMock.mockReturnValue({
      env: { EXECUTION_ACCOUNT: { idFromName: () => "id", get: () => stub } },
    } as never);

    const response = await POST(makeRequest("{}"));
    const body = await response.json() as { created: number; orderSubmitted: boolean };
    expect(response.status).toBe(200);
    expect(body.created).toBe(1);
    expect(body.orderSubmitted).toBe(false);
    expect(calls[0]).toMatchObject({
      strategyVersion: "3.3", symbol: "BTCUSDT", side: "BUY", quoteAsset: "USDT", amount: "100",
    });
    expect(rulesMock).toHaveBeenCalledWith("BTCUSDT");
  });

  it("拒绝Mock、STALE或过期行情，且不会访问DO", async () => {
    const stub = { fetch: vi.fn() };
    contextMock.mockReturnValue({
      env: { EXECUTION_ACCOUNT: { idFromName: () => "id", get: () => stub } },
    } as never);
    getDashboardMock.mockResolvedValue(dashboard({ stale: true }) as never);
    const response = await POST(makeRequest());
    expect(response.status).toBe(409);
    expect(stub.fetch).not.toHaveBeenCalled();
  });

  it("余额不足时不创建intent", async () => {
    const stub = { fetch: vi.fn() };
    contextMock.mockReturnValue({
      env: { EXECUTION_ACCOUNT: { idFromName: () => "id", get: () => stub } },
    } as never);
    balancesMock.mockResolvedValue([{ asset: "USDT", free: "99", locked: "0" }] as never);
    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    expect((await response.json()).created).toBe(0);
    expect(stub.fetch).not.toHaveBeenCalled();
  });

  it("SELL只按基础资产free余额检查，不把locked数量当作可卖数量", async () => {
    const stub = { fetch: vi.fn() };
    contextMock.mockReturnValue({
      env: { EXECUTION_ACCOUNT: { idFromName: () => "id", get: () => stub } },
    } as never);
    getDashboardMock.mockResolvedValue(dashboard({
      coins: [{
        symbol: "BTC",
        signal: { action: { side: "sell", kind: "takeProfit", usdt: 60, qty: 0.001, blocked: [] } },
      }],
    }) as never);
    balancesMock.mockResolvedValue([
      { asset: "BTC", free: "0.0009", locked: "0.01" },
      { asset: "USDT", free: "100", locked: "0" },
    ] as never);
    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    expect((await response.json()).created).toBe(0);
    expect(stub.fetch).not.toHaveBeenCalled();
  });

  it("服务端SELL开关关闭时不创建SELL intent", async () => {
    const stub = { fetch: vi.fn() };
    contextMock.mockReturnValue({
      env: { EXECUTION_ACCOUNT: { idFromName: () => "id", get: () => stub } },
    } as never);
    getDashboardMock.mockResolvedValue(dashboard({
      coins: [{
        symbol: "BTC",
        signal: { action: { side: "sell", kind: "takeProfit", usdt: 60, qty: 0.001, blocked: [] } },
      }],
    }) as never);
    process.env.BINANCE_TESTNET_SELL_ENABLED = "0";
    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    expect((await response.json()).created).toBe(0);
    expect(stub.fetch).not.toHaveBeenCalled();
  });

  it("交易规则步长或最小名义金额为零时拒绝创建intent", async () => {
    const stub = { fetch: vi.fn() };
    contextMock.mockReturnValue({
      env: { EXECUTION_ACCOUNT: { idFromName: () => "id", get: () => stub } },
    } as never);
    rulesMock.mockResolvedValue({
      symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT",
      quoteOrderQtyMarketAllowed: true,
      filters: [
        { filterType: "LOT_SIZE", minQty: "0.00001", maxQty: "100", stepSize: "0" },
        { filterType: "PRICE_FILTER", minPrice: "0.01", maxPrice: "1000000", tickSize: "0.01" },
        { filterType: "MIN_NOTIONAL", minNotional: "5", applyToMarket: true },
      ],
    } as never);
    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    expect((await response.json()).created).toBe(0);
    expect(stub.fetch).not.toHaveBeenCalled();
  });

  it("生产环境、未启用开关、跨站或未认证请求均拒绝", async () => {
    const stub = { fetch: vi.fn() };
    contextMock.mockReturnValue({
      env: { EXECUTION_ACCOUNT: { idFromName: () => "id", get: () => stub } },
    } as never);
    process.env.BINANCE_SPOT_ENVIRONMENT = "production";
    expect((await POST(makeRequest())).status).toBe(403);
    process.env.BINANCE_SPOT_ENVIRONMENT = "testnet";
    process.env.BINANCE_TESTNET_INTENT_CREATION_ENABLED = "0";
    expect((await POST(makeRequest())).status).toBe(403);
    process.env.BINANCE_TESTNET_INTENT_CREATION_ENABLED = "1";
    const cross = new Request("https://dashboard.example/api/execution/intents", {
      method: "POST", headers: { origin: "https://evil.example", authorization: `Basic ${btoa("user:test-password")}` },
    });
    expect((await POST(cross)).status).toBe(403);
    const unauthenticated = new Request("https://dashboard.example/api/execution/intents", {
      method: "POST", headers: { origin: "https://dashboard.example" },
    });
    expect((await POST(unauthenticated)).status).toBe(401);
    expect(stub.fetch).not.toHaveBeenCalled();
  });
});
