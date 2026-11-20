import { beforeEach, describe, expect, it, vi } from "vitest";

const orderResponse = {
  symbol: "BTCUSDT",
  orderId: 987654,
  clientOrderId: "gpt-sim-order-001",
  status: "FILLED",
  origQty: "0.001",
  executedQty: "0.001",
  cummulativeQuoteQty: "100",
  transactTime: 1_800_000_000_000,
};

const exchangeInfoResponse = {
  symbols: [{
    symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT",
    quoteOrderQtyMarketAllowed: true,
    filters: [
      { filterType: "MARKET_LOT_SIZE", minQty: "0.00001", maxQty: "1000", stepSize: "0.00001" },
      { filterType: "MIN_NOTIONAL", minNotional: "5", applyToMarket: true },
    ],
  }],
};

function mockBinanceFetch(overrides: { usdtFree?: string; btcFree?: string } = {}) {
  return vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(exchangeInfoResponse), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify([
      { symbol: "BTCUSDT", lastPrice: "100000", priceChangePercent: "0" },
    ]), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ serverTime: Date.now() }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ balances: [
      { asset: "USDT", free: overrides.usdtFree ?? "1000", locked: "0" },
      { asset: "BTC", free: overrides.btcFree ?? "1", locked: "0" },
    ] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(orderResponse), { status: 200 }));
}

describe("服务端 Spot 下单适配器环境隔离", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("BINANCE_SPOT_ENVIRONMENT", "testnet");
    vi.stubEnv("BINANCE_TESTNET_API_KEY", "SIMULATED_TESTNET_KEY");
    vi.stubEnv("BINANCE_TESTNET_API_SECRET", "SIMULATED_TESTNET_SECRET");
    vi.stubEnv("BINANCE_API_KEY", "SIMULATED_PRODUCTION_KEY");
    vi.stubEnv("BINANCE_API_SECRET", "SIMULATED_PRODUCTION_SECRET");
    vi.stubEnv("BINANCE_TESTNET_BUY_ENABLED", "0");
    vi.stubEnv("BINANCE_TESTNET_SELL_ENABLED", "0");
    vi.stubEnv("BINANCE_PRODUCTION_BUY_ENABLED", "0");
    vi.stubEnv("BINANCE_PRODUCTION_SELL_ENABLED", "0");
  });

  it("生产模式只使用生产 endpoint 和生产凭证", async () => {
    vi.stubEnv("BINANCE_SPOT_ENVIRONMENT", "production");
    vi.stubEnv("BINANCE_PRODUCTION_BUY_ENABLED", "1");
    const fetchMock = mockBinanceFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { submitSpotMarketOrder } = await import("./binance");
    const result = await submitSpotMarketOrder({
      side: "BUY", symbol: "BTCUSDT", amount: "100", clientOrderId: "gpt-sim-order-001",
    });

    expect(result.orderId).toBe(987654);
    // 公开行情可走 data-api.binance.vision；带签名的账户读取和下单必须固定走官方 Spot API。
    expect(String(fetchMock.mock.calls[3][0])).toContain("https://api.binance.com/api/v3/account");
    expect(String(fetchMock.mock.calls[4][0])).toContain("https://api.binance.com/api/v3/order");
    expect(fetchMock.mock.calls[4][1]?.headers).toMatchObject({ "X-MBX-APIKEY": "SIMULATED_PRODUCTION_KEY" });
  });

  it("测试网模式只使用测试网 endpoint 和测试网凭证", async () => {
    vi.stubEnv("BINANCE_TESTNET_SELL_ENABLED", "1");
    const fetchMock = mockBinanceFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { submitSpotMarketOrder } = await import("./binance");
    await submitSpotMarketOrder({
      side: "SELL", symbol: "BTCUSDT", amount: "0.001", clientOrderId: "gpt-sim-order-001",
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain("https://testnet.binance.vision/api/v3/exchangeInfo");
    expect(String(fetchMock.mock.calls[2][0])).toContain("https://testnet.binance.vision/api/v3/time");
    expect(String(fetchMock.mock.calls[4][0])).toContain("https://testnet.binance.vision/api/v3/order");
    expect(fetchMock.mock.calls[4][1]?.headers).toMatchObject({ "X-MBX-APIKEY": "SIMULATED_TESTNET_KEY" });
  });

  it("生产开关关闭时在发起任何网络请求前拒绝订单", async () => {
    vi.stubEnv("BINANCE_SPOT_ENVIRONMENT", "production");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { submitSpotMarketOrder } = await import("./binance");
    await expect(submitSpotMarketOrder({
      side: "BUY", symbol: "BTCUSDT", amount: "100", clientOrderId: "gpt-sim-order-001",
    })).rejects.toThrow("生产环境BUY 订单服务端开关未启用");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("服务端余额不足时拒绝订单且不会发送下单 POST", async () => {
    vi.stubEnv("BINANCE_SPOT_ENVIRONMENT", "production");
    vi.stubEnv("BINANCE_PRODUCTION_BUY_ENABLED", "1");
    const fetchMock = mockBinanceFetch({ usdtFree: "10" });
    vi.stubGlobal("fetch", fetchMock);

    const { submitSpotMarketOrder } = await import("./binance");
    await expect(submitSpotMarketOrder({
      side: "BUY", symbol: "BTCUSDT", amount: "100", clientOrderId: "gpt-sim-order-001",
    })).rejects.toThrow("USDT 可用余额不足");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/v3/order?"))).toBe(false);
  });

  it("卖出数量不符合 MARKET_LOT_SIZE 精度时拒绝下单", async () => {
    vi.stubEnv("BINANCE_TESTNET_SELL_ENABLED", "1");
    const fetchMock = mockBinanceFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { submitSpotMarketOrder } = await import("./binance");
    await expect(submitSpotMarketOrder({
      side: "SELL", symbol: "BTCUSDT", amount: "0.001003", clientOrderId: "gpt-sim-order-001",
    })).rejects.toThrow("订单精度超过币安交易规则");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/v3/order?"))).toBe(false);
  });

  it("测试网缺少测试网凭证时绝不回退到模拟生产凭证", async () => {
    vi.stubEnv("BINANCE_TESTNET_BUY_ENABLED", "1");
    vi.stubEnv("BINANCE_TESTNET_API_KEY", "");
    vi.stubEnv("BINANCE_TESTNET_API_SECRET", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { submitSpotMarketOrder } = await import("./binance");
    await expect(submitSpotMarketOrder({
      side: "BUY", symbol: "BTCUSDT", amount: "100", clientOrderId: "gpt-sim-order-001",
    })).rejects.toThrow("服务端缺少 Binance Testnet API Key/Secret");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
