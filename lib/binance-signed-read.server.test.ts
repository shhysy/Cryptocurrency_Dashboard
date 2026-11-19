import { describe, expect, it } from "vitest";
import { fetchSignedBinanceRead } from "./binance";

describe("server-side Binance signed-read allowlist", () => {
  it("rejects any endpoint outside the read-only allowlist before network access", async () => {
    await expect(fetchSignedBinanceRead("/api/v3/order", { symbol: "BTCUSDT", side: "BUY" } as never))
      .rejects.toThrow("parameter is not allowlisted");
    await expect(fetchSignedBinanceRead("/api/v3/order/cancel", { symbol: "BTCUSDT" }))
      .rejects.toThrow("endpoint is not allowlisted");
    await expect(fetchSignedBinanceRead("/api/v3/order", { symbol: "BTCUSDT", orderId: Number.NaN }))
      .rejects.toThrow("numeric parameter is invalid");
  });

  it("rejects non-finite and oversized parameter values", async () => {
    await expect(fetchSignedBinanceRead("/api/v3/myTrades", { symbol: "BTCUSDT", limit: Infinity }))
      .rejects.toThrow("numeric parameter is invalid");
    await expect(fetchSignedBinanceRead("/api/v3/order", { symbol: "x".repeat(129) }))
      .rejects.toThrow("parameter is too long");
  });
});
