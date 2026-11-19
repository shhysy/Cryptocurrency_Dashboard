import { describe, expect, it, vi, afterEach } from "vitest";
// @ts-expect-error The Worker entry is JavaScript and is loaded directly by Vitest.
import worker from "./trade-fill-email.js";

const secret = "test-hmac-secret-for-worker-tests-0123456789";

function makeEvent(overrides = {}) {
  return {
    id: "trade-fill:BTCUSDT:12345",
    type: "confirmed_trade_fill",
    side: "BUY",
    symbol: "BTCUSDT",
    fillId: "12345",
    exchangeOrderId: "98765",
    filledQty: 0.001,
    fillPrice: 65000,
    quoteQty: 65,
    commission: 0.000001,
    commissionUsdt: 0.065,
    commissionAsset: "BTC",
    filledAt: Date.now(),
    ...overrides,
  };
}

async function signedRequest(events, timestamp = String(Date.now())) {
  const body = JSON.stringify({ events });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(timestamp + "." + body),
  );
  const hex = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return new Request("https://worker.test/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Trade-Timestamp": timestamp, "X-Trade-Signature": hex },
    body,
  });
}

function makeEnv(options = {}) {
  const records = new Map();
  const kv = {
    get: vi.fn(async (key) => records.get(key) ?? null),
    put: vi.fn(async (key, value) => {
      if (options.failPut) throw new Error("simulated KV outage");
      records.set(key, value);
    }),
  };
  return {
    env: {
      TRADE_FILL_NOTIFICATIONS: kv,
      TRADE_NOTIFY_HMAC_SECRET: secret,
      RESEND_API_KEY: "test-resend-key",
      MAIL_FROM: "test@example.com",
      MAIL_TO: "owner@example.com",
    },
    records,
    kv,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("trade-fill email Worker idempotency", () => {
  it("rejects an expired signed request before reading KV or sending email", async () => {
    const { env, kv } = makeEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = await signedRequest([makeEvent()], String(Date.now() - 10 * 60 * 1000));
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(401);
    expect(kv.get).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deduplicates the same fill even when it is retried in a different batch", async () => {
    const { env, records } = makeEnv();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const first = await worker.fetch(await signedRequest([makeEvent()]), env);
    const second = await worker.fetch(await signedRequest([makeEvent(), makeEvent({
      id: "trade-fill:ETHUSDT:456",
      symbol: "ETHUSDT",
      fillId: "456",
      exchangeOrderId: "98766",
    })]), env);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const keys = fetchMock.mock.calls.map((call) => call[0] && call[1].headers["Idempotency-Key"]);
    expect(keys[0]).toBe("trade-fill-" + await digest("trade-fill:BTCUSDT:12345"));
    expect(records.size).toBe(2);
  });

  it("reuses the same Resend idempotency key when KV persistence fails after email acceptance", async () => {
    const { env } = makeEnv({ failPut: true });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const request1 = await signedRequest([makeEvent()]);
    const request2 = await signedRequest([makeEvent()]);
    expect((await worker.fetch(request1, env)).status).toBe(502);
    expect((await worker.fetch(request2, env)).status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers["Idempotency-Key"])
      .toBe(fetchMock.mock.calls[1][1].headers["Idempotency-Key"]);
  });

  it("does not persist a failed Resend request and retries with the same key", async () => {
    const { env, records } = makeEnv();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("temporary failure", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await worker.fetch(await signedRequest([makeEvent()]), env)).status).toBe(502);
    expect(records.size).toBe(0);
    expect((await worker.fetch(await signedRequest([makeEvent()]), env)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers["Idempotency-Key"])
      .toBe(fetchMock.mock.calls[1][1].headers["Idempotency-Key"]);
    expect(records.size).toBe(1);
  });
});

async function digest(value) {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
