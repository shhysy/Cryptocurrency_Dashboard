import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function testnetFetch(side: "BUY" | "SELL") {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/api/v3/time")) {
      return new Response(JSON.stringify({ serverTime: Date.now() }), { status: 200 });
    }
    if (url.includes("/api/v3/exchangeInfo")) {
      return new Response(JSON.stringify({ symbols: [{
        symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT",
        filters: [
          { filterType: "PRICE_FILTER", minPrice: "0.1", maxPrice: "1000000", tickSize: "0.1" },
          { filterType: "LOT_SIZE", minQty: "0.00001", maxQty: "1000", stepSize: "0.00001" },
          { filterType: "NOTIONAL", minNotional: "5" },
        ],
      }] }), { status: 200 });
    }
    if (url.includes("/api/v3/ticker/price")) {
      return new Response(JSON.stringify({ symbol: "BTCUSDT", price: "50000" }), { status: 200 });
    }
    if (url.includes("/api/v3/account")) {
      return new Response(JSON.stringify({ balances: [
        { asset: "USDT", free: "1000", locked: "0" },
        { asset: "BTC", free: side === "SELL" ? "1" : "0", locked: "0" },
      ] }), { status: 200 });
    }
    if (url.includes("/api/v3/order?") && init?.method === "POST") {
      return new Response(JSON.stringify({
        symbol: "BTCUSDT", orderId: 987654, clientOrderId: "gpt-test-limit-123",
        status: "NEW", origQty: side === "BUY" ? "0.00199" : "0.001",
        executedQty: "0", cummulativeQuoteQty: "0", transactTime: Date.now(),
      }), { status: 200 });
    }
    throw new Error("未预期的Binance请求：" + url);
  });
  return { fetchMock, calls };
}

describe("本地Trader在Binance Spot Testnet使用LIMIT GTC", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it.each(["BUY", "SELL"] as const)("将%s订单签名提交到固定Testnet域名且类型为LIMIT GTC", async (side) => {
    vi.stubEnv("AUTO_TRADE_MODE", "testnet");
    vi.stubEnv("BINANCE_SPOT_ENVIRONMENT", "testnet");
    vi.stubEnv("BINANCE_TESTNET_API_KEY", "testnet-public-key");
    vi.stubEnv("BINANCE_TESTNET_API_SECRET", "testnet-private-secret");
    vi.stubEnv("ENABLE_ACCOUNT", "1");
    const { fetchMock, calls } = testnetFetch(side);
    vi.stubGlobal("fetch", fetchMock);

    const { submitTraderSpotLimitOrder } = await import("./binance");
    const result = await submitTraderSpotLimitOrder({
      side, symbol: "BTCUSDT", amount: side === "BUY" ? "100" : "0.001",
      clientOrderId: "gpt-test-limit-123",
    });

    expect(result.orderId).toBe(987654);
    const post = calls.find((call) => call.init?.method === "POST");
    expect(post).toBeDefined();
    const url = new URL(post!.url);
    expect(url.origin).toBe("https://testnet.binance.vision");
    expect(url.pathname).toBe("/api/v3/order");
    expect(url.searchParams.get("side")).toBe(side);
    expect(url.searchParams.get("type")).toBe("LIMIT");
    expect(url.searchParams.get("timeInForce")).toBe("GTC");
    expect(url.searchParams.get("newClientOrderId")).toBe("gpt-test-limit-123");
    expect(url.searchParams.get("signature")).toMatch(/^[a-f0-9]{64}$/);
    expect((post!.init?.headers as Record<string, string>)["X-MBX-APIKEY"]).toBe("testnet-public-key");
    expect(url.searchParams.has("quoteOrderQty")).toBe(false);
  });

  it("缺少Testnet凭证时不会访问交易所或回退生产Key", async () => {
    vi.stubEnv("AUTO_TRADE_MODE", "testnet");
    vi.stubEnv("BINANCE_SPOT_ENVIRONMENT", "testnet");
    vi.stubEnv("BINANCE_API_KEY", "production-key");
    vi.stubEnv("BINANCE_API_SECRET", "production-secret");
    vi.stubEnv("ENABLE_ACCOUNT", "1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { submitTraderSpotLimitOrder } = await import("./binance");
    await expect(submitTraderSpotLimitOrder({
      side: "BUY", symbol: "BTCUSDT", amount: "10", clientOrderId: "gpt-test-limit-123",
    })).rejects.toThrow(/Testnet API Key\/Secret/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
