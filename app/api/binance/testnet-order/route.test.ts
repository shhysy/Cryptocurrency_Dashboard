import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitTestnetSpotMarketOrder } = vi.hoisted(() => ({
  submitTestnetSpotMarketOrder: vi.fn(),
}));

vi.mock("@/lib/binance", () => ({ submitTestnetSpotMarketOrder }));

import { POST } from "./route";

const endpoint = "https://dashboard.example/api/binance/testnet-order";
const payload = {
  side: "BUY",
  symbol: "BTCUSDT",
  amount: "10",
  clientOrderId: "gpt-test-order-123",
};

function makeRequest(
  body: unknown = payload,
  overrides: { authorization?: string; origin?: string; contentType?: string } = {},
): Request {
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

describe("Testnet order API route security", () => {
  beforeEach(() => {
    vi.stubEnv("DASHBOARD_PASSWORD", "correct-password");
    submitTestnetSpotMarketOrder.mockReset();
    submitTestnetSpotMarketOrder.mockResolvedValue({
      symbol: "BTCUSDT",
      orderId: 123,
      clientOrderId: payload.clientOrderId,
      status: "NEW",
      origQty: "0.001",
      executedQty: "0",
      cummulativeQuoteQty: "0",
      transactTime: 1_800_000_000_000,
    });
  });

  it("rejects missing dashboard password and does not call Binance", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "");
    const response = await POST(makeRequest(payload));
    expect(response.status).toBe(401);
    expect(submitTestnetSpotMarketOrder).not.toHaveBeenCalled();
  });

  it("rejects missing or incorrect Basic Auth credentials", async () => {
    const missing = await POST(makeRequest(payload, { authorization: "" }));
    const wrong = await POST(makeRequest(payload, {
      authorization: "Basic " + btoa("user:wrong-password"),
    }));
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(submitTestnetSpotMarketOrder).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests", async () => {
    const response = await POST(makeRequest(payload, { origin: "https://attacker.example" }));
    expect(response.status).toBe(403);
    expect(submitTestnetSpotMarketOrder).not.toHaveBeenCalled();
  });

  it("rejects non-JSON content types", async () => {
    const response = await POST(makeRequest(payload, { contentType: "text/plain" }));
    expect(response.status).toBe(415);
    expect(submitTestnetSpotMarketOrder).not.toHaveBeenCalled();
  });

  it("rejects unknown fields before reaching the order adapter", async () => {
    const response = await POST(makeRequest({ ...payload, price: "1" }));
    expect(response.status).toBe(400);
    expect(submitTestnetSpotMarketOrder).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and oversized bodies", async () => {
    const malformed = await POST(makeRequest("{not-json"));
    const oversized = await POST(makeRequest("x".repeat(2_049)));
    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(submitTestnetSpotMarketOrder).not.toHaveBeenCalled();
  });

  it("forwards only validated order fields after authentication", async () => {
    const response = await POST(makeRequest(payload));
    expect(response.status).toBe(200);
    expect(submitTestnetSpotMarketOrder).toHaveBeenCalledWith(payload);
  });
});
