import { describe, expect, it } from "vitest";
import { assertSimpleEarnSupported, resolveBinanceSpotEnvironment, resolveBinanceSpotSubmissionSwitches } from "./binance-environment";

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

describe("Binance Simple Earn environment guard", () => {
  it("rejects Simple Earn endpoints while Spot Testnet is selected", () => {
    expect(() => assertSimpleEarnSupported("testnet")).toThrow("不支持 Simple Earn");
  });

  it("allows production-only Simple Earn path in production mode", () => {
    expect(() => assertSimpleEarnSupported("production")).not.toThrow();
  });
});

describe("Spot order submission environment switches", () => {
  it("keeps production BUY and SELL hard-disabled even if testnet flags are set", () => {
    expect(resolveBinanceSpotSubmissionSwitches("production", {
      NEXT_PUBLIC_BINANCE_SPOT_TESTNET_BUY_ENABLED: "1",
      NEXT_PUBLIC_BINANCE_SPOT_TESTNET_SELL_ENABLED: "1",
    })).toEqual({ buyEnabled: false, sellEnabled: false });
  });

  it("requires separate explicit testnet opt-in for BUY and SELL", () => {
    expect(resolveBinanceSpotSubmissionSwitches("testnet", {
      NEXT_PUBLIC_BINANCE_SPOT_TESTNET_BUY_ENABLED: "1",
    })).toEqual({ buyEnabled: true, sellEnabled: false });
    expect(resolveBinanceSpotSubmissionSwitches("testnet", {
      NEXT_PUBLIC_BINANCE_SPOT_TESTNET_SELL_ENABLED: "1",
    })).toEqual({ buyEnabled: false, sellEnabled: true });
  });

  it("keeps both testnet submission paths disabled by default", () => {
    expect(resolveBinanceSpotSubmissionSwitches("testnet", {}))
      .toEqual({ buyEnabled: false, sellEnabled: false });
  });
});


describe("Server-only Binance environment", () => {
  it("uses only testnet credentials and fixed testnet endpoint in testnet mode", async () => {
    const { resolveServerBinanceEnvironment } = await import("./binance-environment");
    expect(resolveServerBinanceEnvironment({
      BINANCE_SPOT_ENVIRONMENT: "testnet",
      BINANCE_TESTNET_API_KEY: "test-key",
      BINANCE_TESTNET_API_SECRET: "test-secret",
      BINANCE_API_KEY: "production-key",
      BINANCE_API_SECRET: "production-secret",
      BINANCE_BASE_URL: "https://custom-production.example",
    })).toEqual({
      mode: "testnet",
      apiBase: "https://testnet.binance.vision",
      apiKey: "test-key",
      apiSecret: "test-secret",
    });
  });

  it("never falls back to production credentials in testnet mode", async () => {
    const { resolveServerBinanceEnvironment } = await import("./binance-environment");
    expect(resolveServerBinanceEnvironment({
      BINANCE_SPOT_ENVIRONMENT: "testnet",
      BINANCE_API_KEY: "production-key",
      BINANCE_API_SECRET: "production-secret",
    })).toMatchObject({ mode: "testnet", apiKey: "", apiSecret: "" });
  });

  it("uses production credentials only in production mode", async () => {
    const { resolveServerBinanceEnvironment } = await import("./binance-environment");
    expect(resolveServerBinanceEnvironment({
      BINANCE_API_KEY: "production-key",
      BINANCE_API_SECRET: "production-secret",
    })).toMatchObject({
      mode: "production",
      apiBase: "https://api.binance.com",
      apiKey: "production-key",
      apiSecret: "production-secret",
    });
  });

  it("rejects misspelled environment values instead of silently selecting production", async () => {
    const { resolveServerBinanceEnvironment } = await import("./binance-environment");
    expect(() => resolveServerBinanceEnvironment({
      BINANCE_SPOT_ENVIRONMENT: "testent",
      BINANCE_API_KEY: "production-key",
      BINANCE_API_SECRET: "production-secret",
    })).toThrow("只能是 testnet 或 production");
  });

});


describe("Server-side Testnet order gate", () => {
  it("allows BUY only when Testnet mode and server BUY switch are explicitly enabled", async () => {
    const { isTestnetOrderSubmissionEnabled } = await import("./binance-environment");
    expect(isTestnetOrderSubmissionEnabled("testnet", "BUY", { BINANCE_TESTNET_BUY_ENABLED: "1" })).toBe(true);
    expect(isTestnetOrderSubmissionEnabled("testnet", "BUY", { BINANCE_TESTNET_SELL_ENABLED: "1" })).toBe(false);
  });

  it("allows SELL only when Testnet mode and server SELL switch are explicitly enabled", async () => {
    const { isTestnetOrderSubmissionEnabled } = await import("./binance-environment");
    expect(isTestnetOrderSubmissionEnabled("testnet", "SELL", { BINANCE_TESTNET_SELL_ENABLED: "1" })).toBe(true);
    expect(isTestnetOrderSubmissionEnabled("testnet", "SELL", { BINANCE_TESTNET_BUY_ENABLED: "1" })).toBe(false);
  });

  it("rejects both sides in production regardless of environment flags", async () => {
    const { isTestnetOrderSubmissionEnabled } = await import("./binance-environment");
    const env = { BINANCE_TESTNET_BUY_ENABLED: "1", BINANCE_TESTNET_SELL_ENABLED: "1" };
    expect(isTestnetOrderSubmissionEnabled("production", "BUY", env)).toBe(false);
    expect(isTestnetOrderSubmissionEnabled("production", "SELL", env)).toBe(false);
  });
});

describe("服务端现货订单环境与方向双重隔离", () => {
  it("测试网开关不能授权生产买卖", async () => {
    const { isSpotOrderSubmissionEnabled } = await import("./binance-environment");
    const env = { BINANCE_TESTNET_BUY_ENABLED: "1", BINANCE_TESTNET_SELL_ENABLED: "1" };
    expect(isSpotOrderSubmissionEnabled("production", "BUY", env)).toBe(false);
    expect(isSpotOrderSubmissionEnabled("production", "SELL", env)).toBe(false);
  });

  it("生产 BUY 和 SELL 必须分别显式授权", async () => {
    const { isSpotOrderSubmissionEnabled } = await import("./binance-environment");
    const buyOnly = { BINANCE_PRODUCTION_BUY_ENABLED: "1" };
    expect(isSpotOrderSubmissionEnabled("production", "BUY", buyOnly)).toBe(true);
    expect(isSpotOrderSubmissionEnabled("production", "SELL", buyOnly)).toBe(false);
  });

  it("生产开关不能授权测试网，测试网开关也不能授权生产", async () => {
    const { isSpotOrderSubmissionEnabled } = await import("./binance-environment");
    const productionOnly = { BINANCE_PRODUCTION_BUY_ENABLED: "1", BINANCE_PRODUCTION_SELL_ENABLED: "1" };
    expect(isSpotOrderSubmissionEnabled("testnet", "BUY", productionOnly)).toBe(false);
    expect(isSpotOrderSubmissionEnabled("testnet", "SELL", productionOnly)).toBe(false);
  });

  it("所有环境未配置开关时默认禁止订单提交", async () => {
    const { isSpotOrderSubmissionEnabled } = await import("./binance-environment");
    for (const mode of ["testnet", "production"] as const) {
      expect(isSpotOrderSubmissionEnabled(mode, "BUY", {})).toBe(false);
      expect(isSpotOrderSubmissionEnabled(mode, "SELL", {})).toBe(false);
    }
  });
});
