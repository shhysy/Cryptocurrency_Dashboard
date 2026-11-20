import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitSpotMarketOrder } = vi.hoisted(() => ({ submitSpotMarketOrder: vi.fn() }));
vi.mock("@/lib/binance", () => ({ submitSpotMarketOrder }));

import { POST } from "./route";

const endpoint = "https://dashboard.example/api/binance/spot-order";
const payload = { side: "BUY", symbol: "BTCUSDT", amount: "10", clientOrderId: "gpt-sim-order-001" };

function makeRequest(body: unknown = payload, overrides: {
  authorization?: string; origin?: string; contentType?: string;
} = {}): Request {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      authorization: overrides.authorization ?? "Basic " + btoa("user:correct-password"),
      origin: overrides.origin ?? "https://dashboard.example",
      "content-type": overrides.contentType ?? "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("统一 Spot 下单路由安全", () => {
  beforeEach(() => {
    vi.stubEnv("DASHBOARD_PASSWORD", "correct-password");
    submitSpotMarketOrder.mockReset();
    submitSpotMarketOrder.mockResolvedValue({
      symbol: "BTCUSDT", orderId: 123, clientOrderId: payload.clientOrderId,
      status: "NEW", origQty: "0.001", executedQty: "0",
      cummulativeQuoteQty: "0", transactTime: 1_800_000_000_000,
    });
  });

  it("缺少密码或认证错误时拒绝且不调用下单适配器", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "");
    expect((await POST(makeRequest())).status).toBe(401);
    vi.stubEnv("DASHBOARD_PASSWORD", "correct-password");
    expect((await POST(makeRequest(payload, { authorization: "Basic " + btoa("user:wrong") }))).status).toBe(401);
    expect(submitSpotMarketOrder).not.toHaveBeenCalled();
  });

  it("拒绝跨站请求和缺失 Origin", async () => {
    expect((await POST(makeRequest(payload, { origin: "https://attacker.example" }))).status).toBe(403);
    expect((await POST(makeRequest(payload, { origin: "" }))).status).toBe(403);
    expect(submitSpotMarketOrder).not.toHaveBeenCalled();
  });

  it("拒绝非 JSON、额外字段、错误 JSON 和超大请求", async () => {
    expect((await POST(makeRequest(payload, { contentType: "text/plain" }))).status).toBe(415);
    expect((await POST(makeRequest({ ...payload, price: "1" }))).status).toBe(400);
    expect((await POST(makeRequest("{bad-json"))).status).toBe(400);
    expect((await POST(makeRequest("x".repeat(2049)))).status).toBe(413);
    expect(submitSpotMarketOrder).not.toHaveBeenCalled();
  });

  it("认证通过后只转发严格校验的订单字段", async () => {
    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    expect(submitSpotMarketOrder).toHaveBeenCalledWith(payload);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
