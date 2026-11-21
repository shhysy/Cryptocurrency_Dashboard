import { afterEach, describe, expect, it, vi } from "vitest";
import { isLocalTraderStatusRequest } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("本地Trader状态接口访问边界", () => {
  it("默认关闭，必须显式启用", () => {
    vi.stubEnv("TRADER_STATUS_API_ENABLED", "0");
    const request = new Request("http://127.0.0.1:3000/api/trader-status", {
      headers: { host: "127.0.0.1:3000" },
    });
    expect(isLocalTraderStatusRequest(request)).toBe(false);
  });

  it("仅接受loopback Host与匹配的loopback Origin", () => {
    vi.stubEnv("TRADER_STATUS_API_ENABLED", "1");
    const request = new Request("http://127.0.0.1:3000/api/trader-status", {
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
      },
    });
    expect(isLocalTraderStatusRequest(request)).toBe(true);
  });

  it("拒绝公网Host、跨主机Origin和反向代理转发头", () => {
    vi.stubEnv("TRADER_STATUS_API_ENABLED", "1");
    const remote = new Request("https://example.com/api/trader-status", {
      headers: { host: "example.com" },
    });
    const forwarded = new Request("http://127.0.0.1:3000/api/trader-status", {
      headers: { host: "127.0.0.1:3000", "x-forwarded-for": "203.0.113.10" },
    });
    const foreignOrigin = new Request("http://127.0.0.1:3000/api/trader-status", {
      headers: { host: "127.0.0.1:3000", origin: "https://example.com" },
    });
    expect(isLocalTraderStatusRequest(remote)).toBe(false);
    expect(isLocalTraderStatusRequest(forwarded)).toBe(false);
    expect(isLocalTraderStatusRequest(foreignOrigin)).toBe(false);
  });
});
