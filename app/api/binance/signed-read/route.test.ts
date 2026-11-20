import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchSignedBinanceRead } = vi.hoisted(() => ({
  fetchSignedBinanceRead: vi.fn(),
}));

vi.mock("@/lib/binance", () => ({ fetchSignedBinanceRead }));

import { POST } from "./route";

const endpoint = "https://dashboard.example/api/binance/signed-read";
const payload = { path: "/api/v3/account", params: { omitZeroBalances: "true" } };

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

describe("Binance signed-read API route security", () => {
  beforeEach(() => {
    vi.stubEnv("DASHBOARD_PASSWORD", "correct-password");
    fetchSignedBinanceRead.mockReset();
    fetchSignedBinanceRead.mockResolvedValue({ balances: [] });
  });

  it("rejects missing dashboard password and does not call Binance", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "");
    const response = await POST(makeRequest());
    expect(response.status).toBe(401);
    expect(fetchSignedBinanceRead).not.toHaveBeenCalled();
  });

  it("rejects missing or incorrect Basic Auth credentials", async () => {
    const missing = await POST(makeRequest(payload, { authorization: "" }));
    const wrong = await POST(makeRequest(payload, {
      authorization: "Basic " + btoa("user:wrong-password"),
    }));
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(fetchSignedBinanceRead).not.toHaveBeenCalled();
  });

  it("rejects cross-origin and missing-origin requests", async () => {
    const crossOrigin = await POST(makeRequest(payload, { origin: "https://attacker.example" }));
    const missingOrigin = await POST(makeRequest(payload, { origin: "" }));
    expect(crossOrigin.status).toBe(403);
    expect(missingOrigin.status).toBe(403);
    expect(fetchSignedBinanceRead).not.toHaveBeenCalled();
  });

  it("rejects non-JSON content types", async () => {
    const response = await POST(makeRequest(payload, { contentType: "text/plain" }));
    expect(response.status).toBe(415);
    expect(fetchSignedBinanceRead).not.toHaveBeenCalled();
  });

  it("rejects unknown body fields and malformed or oversized bodies", async () => {
    const unknown = await POST(makeRequest({ ...payload, secret: "no" }));
    const malformed = await POST(makeRequest("{not-json"));
    const oversized = await POST(makeRequest("x".repeat(8_193)));
    expect(unknown.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(fetchSignedBinanceRead).not.toHaveBeenCalled();
  });

  it("forwards only authenticated same-origin signed-read arguments", async () => {
    const response = await POST(makeRequest());
    expect(response.status).toBe(200);
    expect(fetchSignedBinanceRead).toHaveBeenCalledWith(payload.path, payload.params);
  });
});
