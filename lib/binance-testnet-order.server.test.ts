import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("server-side Binance Spot Testnet order adapter", () => {
  it("signs and submits BUY only to the fixed Spot Testnet endpoint", async () => {
    vi.stubEnv("BINANCE_SPOT_ENVIRONMENT", "testnet");
    vi.stubEnv("BINANCE_TESTNET_API_KEY", "testnet-public-key");
    vi.stubEnv("BINANCE_TESTNET_API_SECRET", "testnet-private-secret");
    vi.stubEnv("BINANCE_TESTNET_BUY_ENABLED", "1");
    vi.stubEnv("ENABLE_ACCOUNT", "1");

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v3/time")) {
        return new Response(JSON.stringify({ serverTime: Date.now() }), { status: 200 });
      }
      if (url.includes("/api/v3/exchangeInfo")) {
        return new Response(JSON.stringify({
          symbols: [{
            symbol: "BTCUSDT",
            status: "TRADING",
            baseAsset: "BTC",
            quoteAsset: "USDT",
            quoteOrderQtyMarketAllowed: true,
            filters: [
              { filterType: "LOT_SIZE", minQty: "0.00001", maxQty: "1000", stepSize: "0.00001" },
              { filterType: "NOTIONAL", minNotional: "5", applyMinToMarket: true },
            ],
          }],
        }), { status: 200 });
      }
      if (url.includes("/api/v3/ticker/24hr") || url.includes("/api/v3/ticker")) {
        return new Response(JSON.stringify([{
          symbol: "BTCUSDT",
          lastPrice: "50000",
          priceChangePercent: "0",
        }]), { status: 200 });
      }
      if (url.includes("/api/v3/account")) {
        return new Response(JSON.stringify({
          balances: [{ asset: "USDT", free: "1000", locked: "0" }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        symbol: "BTCUSDT",
        orderId: 987654,
        clientOrderId: "gpt-test-buy-123",
        status: "NEW",
        origQty: "0.001",
        executedQty: "0",
        cummulativeQuoteQty: "0",
        transactTime: Date.now(),
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { submitTestnetSpotMarketOrder } = await import("./binance");
    const result = await submitTestnetSpotMarketOrder({
      side: "BUY",
      symbol: "BTCUSDT",
      amount: "10",
      clientOrderId: "gpt-test-buy-123",
    });

    expect(result.orderId).toBe(987654);
    const orderCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/v3/order?"));
    expect(orderCall).toBeDefined();
    const orderUrl = new URL(String(orderCall?.[0]));
    expect(orderUrl.origin).toBe("https://testnet.binance.vision");
    expect(orderUrl.searchParams.get("side")).toBe("BUY");
    expect(orderUrl.searchParams.get("type")).toBe("MARKET");
    expect(orderUrl.searchParams.get("quoteOrderQty")).toBe("10");
    expect(orderUrl.searchParams.get("newClientOrderId")).toBe("gpt-test-buy-123");
    expect(orderUrl.searchParams.get("signature")).toMatch(/^[a-f0-9]{64}$/);
    expect((orderCall?.[1] as RequestInit).headers).toEqual({ "X-MBX-APIKEY": "testnet-public-key" });
  });

  it("rejects production mode even when Testnet order switches are enabled", async () => {
    vi.stubEnv("BINANCE_SPOT_ENVIRONMENT", "production");
    vi.stubEnv("BINANCE_API_KEY", "production-key");
    vi.stubEnv("BINANCE_API_SECRET", "production-secret");
    vi.stubEnv("BINANCE_TESTNET_BUY_ENABLED", "1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { submitTestnetSpotMarketOrder } = await import("./binance");
    await expect(submitTestnetSpotMarketOrder({
      side: "BUY",
      symbol: "BTCUSDT",
      amount: "10",
      clientOrderId: "gpt-test-buy-123",
    })).rejects.toThrow(/Testnet|测试网|production|生产/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when Testnet BUY switch is off", async () => {
    vi.stubEnv("BINANCE_SPOT_ENVIRONMENT", "testnet");
    vi.stubEnv("BINANCE_TESTNET_API_KEY", "testnet-public-key");
    vi.stubEnv("BINANCE_TESTNET_API_SECRET", "testnet-private-secret");
    vi.stubEnv("BINANCE_TESTNET_BUY_ENABLED", "0");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { submitTestnetSpotMarketOrder } = await import("./binance");
    await expect(submitTestnetSpotMarketOrder({
      side: "BUY",
      symbol: "BTCUSDT",
      amount: "10",
      clientOrderId: "gpt-test-buy-123",
    })).rejects.toThrow(/开关|未启用|disabled/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid clientOrderId before contacting Binance", async () => {
    vi.stubEnv("BINANCE_SPOT_ENVIRONMENT", "testnet");
    vi.stubEnv("BINANCE_TESTNET_API_KEY", "testnet-public-key");
    vi.stubEnv("BINANCE_TESTNET_API_SECRET", "testnet-private-secret");
    vi.stubEnv("BINANCE_TESTNET_BUY_ENABLED", "1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { submitTestnetSpotMarketOrder } = await import("./binance");
    await expect(submitTestnetSpotMarketOrder({
      side: "BUY",
      symbol: "BTCUSDT",
      amount: "10",
      clientOrderId: "bad id with spaces",
    })).rejects.toThrow(/clientOrderId/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
