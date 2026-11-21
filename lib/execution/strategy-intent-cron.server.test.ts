import { describe, expect, it, vi } from "vitest";
import { runTestnetStrategyIntentScan } from "./strategy-intent-cron.server";

describe("Testnet后台策略意图Cron", () => {
  it("只有Testnet、intent创建、扫描和至少一个方向开关开启才调用自引用路由", async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe("https://cryptocurrency-dashboard/api/execution/intents");
      expect(request.method).toBe("POST");
      expect(request.headers.get("origin")).toBe("https://cryptocurrency-dashboard");
      expect(request.headers.get("authorization")).toMatch(/^Basic /);
      return Response.json({ created: 2, intents: [{ state: "queued" }] });
    });
    const env = {
      WORKER_SELF_REFERENCE: { fetch },
      DASHBOARD_PASSWORD: "test-secret",
      BINANCE_SPOT_ENVIRONMENT: "testnet",
      BINANCE_TESTNET_INTENT_CREATION_ENABLED: "true",
      BINANCE_TESTNET_INTENT_SCAN_ENABLED: "true",
      BINANCE_TESTNET_BUY_ENABLED: "1",
      BINANCE_TESTNET_SELL_ENABLED: "0",
    };
    await expect(runTestnetStrategyIntentScan(env)).resolves.toMatchObject({
      state: "scanned", created: 2,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("生产环境或任何总开关关闭时不调用自引用路由", async () => {
    const fetch = vi.fn();
    const base = {
      WORKER_SELF_REFERENCE: { fetch },
      DASHBOARD_PASSWORD: "secret",
      BINANCE_SPOT_ENVIRONMENT: "testnet",
      BINANCE_TESTNET_INTENT_CREATION_ENABLED: "true",
      BINANCE_TESTNET_INTENT_SCAN_ENABLED: "true",
      BINANCE_TESTNET_BUY_ENABLED: "1",
      BINANCE_TESTNET_SELL_ENABLED: "0",
    };
    await expect(runTestnetStrategyIntentScan({ ...base, BINANCE_SPOT_ENVIRONMENT: "production" }))
      .resolves.toMatchObject({ state: "disabled" });
    await expect(runTestnetStrategyIntentScan({ ...base, BINANCE_TESTNET_INTENT_SCAN_ENABLED: "false" }))
      .resolves.toMatchObject({ state: "disabled" });
    await expect(runTestnetStrategyIntentScan({
      ...base, BINANCE_TESTNET_BUY_ENABLED: "0", BINANCE_TESTNET_SELL_ENABLED: "0",
    })).resolves.toMatchObject({ state: "disabled" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("STALE数据409返回skipped，不当成扫描成功", async () => {
    const fetch = vi.fn(async () => Response.json({ error: "数据STALE" }, { status: 409 }));
    const result = await runTestnetStrategyIntentScan({
      WORKER_SELF_REFERENCE: { fetch },
      DASHBOARD_PASSWORD: "secret",
      BINANCE_SPOT_ENVIRONMENT: "testnet",
      BINANCE_TESTNET_INTENT_CREATION_ENABLED: "true",
      BINANCE_TESTNET_INTENT_SCAN_ENABLED: "true",
      BINANCE_TESTNET_BUY_ENABLED: "1",
    });
    expect(result).toEqual({ state: "skipped", reason: "数据STALE" });
  });

  it("内部路由失败时抛错供Cron日志记录", async () => {
    const fetch = vi.fn(async () => Response.json({ error: "配置错误" }, { status: 403 }));
    await expect(runTestnetStrategyIntentScan({
      WORKER_SELF_REFERENCE: { fetch },
      DASHBOARD_PASSWORD: "secret",
      BINANCE_SPOT_ENVIRONMENT: "testnet",
      BINANCE_TESTNET_INTENT_CREATION_ENABLED: "true",
      BINANCE_TESTNET_INTENT_SCAN_ENABLED: "true",
      BINANCE_TESTNET_SELL_ENABLED: "1",
    })).rejects.toThrow("HTTP 403");
  });
});
