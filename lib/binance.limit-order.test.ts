import { beforeEach, describe, expect, it, vi } from "vitest";

const rules = {
  symbols: [{
    symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT",
    filters: [
      { filterType: "PRICE_FILTER", minPrice: "0.1", maxPrice: "1000000", tickSize: "0.1" },
      { filterType: "LOT_SIZE", minQty: "0.00001", maxQty: "1000", stepSize: "0.00001" },
      { filterType: "MIN_NOTIONAL", minNotional: "5" },
    ],
  }],
};

function mockFetch(side: "BUY" | "SELL" = "BUY") {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/api/v3/exchangeInfo")) return new Response(JSON.stringify(rules), { status: 200 });
    if (url.includes("/api/v3/ticker/price")) {
      return new Response(JSON.stringify({ symbol: "BTCUSDT", price: "100000" }), { status: 200 });
    }
    if (url.includes("/api/v3/time")) {
      return new Response(JSON.stringify({ serverTime: Date.now() }), { status: 200 });
    }
    if (url.includes("/api/v3/account")) {
      return new Response(JSON.stringify({ balances: [
        { asset: "USDT", free: "1000", locked: "0" },
        { asset: "BTC", free: side === "SELL" ? "1" : "0", locked: "0" },
      ] }), { status: 200 });
    }
    if (url.includes("/api/v3/order?")) {
      return new Response(JSON.stringify({
        symbol: "BTCUSDT", orderId: 987654, clientOrderId: "limit-test-001",
        status: "NEW", origQty: side === "BUY" ? "0.00099" : "0.001",
        executedQty: "0", cummulativeQuoteQty: "0", transactTime: Date.now(),
      }), { status: 200 });
    }
    throw new Error("未预期的Binance请求：" + url);
  });
  return { fetchMock, calls };
}

describe("Trader自动订单使用LIMIT GTC", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("AUTO_TRADE_MODE", "testnet");
    vi.stubEnv("BINANCE_TESTNET_API_KEY", "SIMULATED_TESTNET_KEY");
    vi.stubEnv("BINANCE_TESTNET_API_SECRET", "SIMULATED_TESTNET_SECRET");
    vi.stubEnv("ENABLE_ACCOUNT", "1");
  });

  it("BUY使用参考价+0.5%、LIMIT GTC和LOT_SIZE数量", async () => {
    const { fetchMock, calls } = mockFetch("BUY");
    vi.stubGlobal("fetch", fetchMock);
    const { submitTraderSpotLimitOrder } = await import("./binance");
    const result = await submitTraderSpotLimitOrder({
      side: "BUY", symbol: "BTCUSDT", amount: "100", clientOrderId: "limit-test-001",
    });
    expect(result.status).toBe("NEW");
    const post = calls.find((call) => call.init?.method === "POST");
    expect(post).toBeDefined();
    const query = new URL(post!.url).searchParams;
    expect(query.get("type")).toBe("LIMIT");
    expect(query.get("timeInForce")).toBe("GTC");
    expect(query.get("price")).toBe("100500");
    expect(query.get("quantity")).toBe("0.00099");
    expect(query.has("quoteOrderQty")).toBe(false);
  });

  it("SELL使用参考价-0.5%、LIMIT GTC且不改变授权数量", async () => {
    const { fetchMock, calls } = mockFetch("SELL");
    vi.stubGlobal("fetch", fetchMock);
    const { submitTraderSpotLimitOrder } = await import("./binance");
    await submitTraderSpotLimitOrder({
      side: "SELL", symbol: "BTCUSDT", amount: "0.001", clientOrderId: "limit-test-001",
    });
    const post = calls.find((call) => call.init?.method === "POST");
    expect(post).toBeDefined();
    const query = new URL(post!.url).searchParams;
    expect(query.get("type")).toBe("LIMIT");
    expect(query.get("timeInForce")).toBe("GTC");
    expect(query.get("price")).toBe("99500");
    expect(query.get("quantity")).toBe("0.001");
  });

  it("没有PRICE_FILTER或LOT_SIZE时拒绝POST", async () => {
    const { fetchMock, calls } = mockFetch("BUY");
    const badRules = { symbols: [{ ...rules.symbols[0], filters: [] }] };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v3/exchangeInfo")) return new Response(JSON.stringify(badRules), { status: 200 });
      throw new Error("不应继续请求");
    });
    vi.stubGlobal("fetch", fetchMock);
    const { submitTraderSpotLimitOrder } = await import("./binance");
    await expect(submitTraderSpotLimitOrder({
      side: "BUY", symbol: "BTCUSDT", amount: "100", clientOrderId: "limit-test-001",
    })).rejects.toThrow("缺少PRICE_FILTER或LOT_SIZE");
    expect(calls.some((call) => call.init?.method === "POST")).toBe(false);
  });
});
