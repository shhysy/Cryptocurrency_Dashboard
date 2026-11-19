import { describe, expect, it } from "vitest";
import { resolveBinanceSpotEnvironment } from "./binance-environment";

describe("Binance Spot environment isolation", () => {
  it("selects the Spot Testnet endpoint and only testnet credentials", () => {
    const result = resolveBinanceSpotEnvironment({
      NEXT_PUBLIC_BINANCE_SPOT_TESTNET: "1",
      NEXT_PUBLIC_BINANCE_TESTNET_API_KEY: "test-key",
      NEXT_PUBLIC_BINANCE_TESTNET_API_SECRET: "test-secret",
      NEXT_PUBLIC_BINANCE_API_KEY: "production-key",
      NEXT_PUBLIC_BINANCE_API_SECRET: "production-secret",
      fallbackApiKey: "fallback-key",
      fallbackApiSecret: "fallback-secret",
    });
    expect(result).toEqual({
      mode: "testnet",
      apiBase: "https://testnet.binance.vision",
      apiKey: "test-key",
      apiSecret: "test-secret",
    });
  });

  it("never falls back to production credentials when testnet credentials are absent", () => {
    const result = resolveBinanceSpotEnvironment({
      NEXT_PUBLIC_BINANCE_SPOT_TESTNET: "1",
      NEXT_PUBLIC_BINANCE_API_KEY: "production-key",
      NEXT_PUBLIC_BINANCE_API_SECRET: "production-secret",
      fallbackApiKey: "fallback-key",
      fallbackApiSecret: "fallback-secret",
    });
    expect(result.mode).toBe("testnet");
    expect(result.apiKey).toBe("");
    expect(result.apiSecret).toBe("");
  });

  it("keeps production endpoint and credentials when testnet is not explicitly enabled", () => {
    const result = resolveBinanceSpotEnvironment({
      NEXT_PUBLIC_BINANCE_API_KEY: "production-key",
      NEXT_PUBLIC_BINANCE_API_SECRET: "production-secret",
    });
    expect(result).toEqual({
      mode: "production",
      apiBase: "https://api.binance.com",
      apiKey: "production-key",
      apiSecret: "production-secret",
    });
  });
});
