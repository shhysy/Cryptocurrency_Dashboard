import { afterEach, describe, expect, it, vi } from "vitest";
import { isTraderOrderSubmissionAuthorized, parseAutoTradeMode } from "./auto-trade-mode";

afterEach(() => vi.unstubAllEnvs());

describe("统一Trader模式授权", () => {
  it("testnet模式与交易所环境一致时自动授权BUY/SELL，无需维护两组开关", () => {
    vi.stubEnv("AUTO_TRADE_MODE", "testnet");
    expect(isTraderOrderSubmissionAuthorized("testnet")).toBe(true);
  });

  it("off/dry-run不能提交订单", () => {
    vi.stubEnv("AUTO_TRADE_MODE", "off");
    expect(isTraderOrderSubmissionAuthorized("testnet")).toBe(false);
    vi.stubEnv("AUTO_TRADE_MODE", "dry-run");
    expect(isTraderOrderSubmissionAuthorized("testnet")).toBe(false);
  });

  it("交易所环境与AUTO_TRADE_MODE不一致时拒绝", () => {
    vi.stubEnv("AUTO_TRADE_MODE", "testnet");
    expect(isTraderOrderSubmissionAuthorized("production")).toBe(false);
  });

  it("production还必须有独立明确确认变量", () => {
    vi.stubEnv("AUTO_TRADE_MODE", "production");
    vi.stubEnv("I_UNDERSTAND_LIVE_TRADING", "no");
    expect(isTraderOrderSubmissionAuthorized("production")).toBe(false);
    vi.stubEnv("I_UNDERSTAND_LIVE_TRADING", "yes");
    expect(isTraderOrderSubmissionAuthorized("production")).toBe(true);
  });

  it("拒绝未知模式", () => {
    expect(() => parseAutoTradeMode("live")).toThrow("AUTO_TRADE_MODE只允许");
  });
});
