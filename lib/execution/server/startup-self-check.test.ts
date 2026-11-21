import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mocks = vi.hoisted(() => ({
  hasCredentials: vi.fn(() => true),
  getServerBinanceSpotMode: vi.fn(() => "testnet"),
  fetchBinanceServerTime: vi.fn(async () => ({
    serverTime: Date.now(),
    localMidpoint: Date.now(),
    roundTripMs: 10,
  })),
  fetchSignedBinanceRead: vi.fn(async () => ({
    canTrade: true,
    canWithdraw: false,
    balances: [{ asset: "USDT", free: "0", locked: "0" }],
  })),
}));

vi.mock("@/lib/binance", () => mocks);

import { runStartupSelfCheck } from "./startup-self-check";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.clearAllMocks();
});

async function paths() {
  const dir = await mkdtemp(join(tmpdir(), "selfcheck-"));
  directories.push(dir);
  return { dataDir: join(dir, "data"), dbPath: join(dir, "db", "trader.db") };
}

describe("启动自检", () => {
  it("off模式只检查数据目录和SQLite目录可写，不请求交易所", async () => {
    const result = await runStartupSelfCheck({ mode: "off", ...(await paths()) });
    expect(result.ok).toBe(true);
    expect(mocks.fetchSignedBinanceRead).not.toHaveBeenCalled();
    expect(mocks.fetchBinanceServerTime).not.toHaveBeenCalled();
  });

  it("Testnet真实核验交易权限、提现关闭、USDT余额和服务器时钟", async () => {
    mocks.getServerBinanceSpotMode.mockReturnValue("testnet");
    const result = await runStartupSelfCheck({ mode: "testnet", ...(await paths()) });
    expect(result.ok).toBe(true);
    expect(mocks.fetchSignedBinanceRead).toHaveBeenCalledWith("/api/v3/account", {
      omitZeroBalances: "false",
    });
    expect(mocks.fetchBinanceServerTime).toHaveBeenCalledTimes(1);
  });

  it("提现权限开启时拒绝启动", async () => {
    mocks.fetchSignedBinanceRead.mockResolvedValue({
      canTrade: true,
      canWithdraw: true,
      balances: [{ asset: "USDT", free: "100", locked: "0" }],
    });
    const result = await runStartupSelfCheck({ mode: "testnet", ...(await paths()) });
    expect(result.ok).toBe(false);
    expect(result.reasons.join("；")).toContain("提现权限");
  });

  it("缺少现货交易权限或USDT余额时拒绝启动", async () => {
    mocks.fetchSignedBinanceRead.mockResolvedValue({
      canTrade: false,
      canWithdraw: false,
      balances: [],
    });
    const result = await runStartupSelfCheck({ mode: "testnet", ...(await paths()) });
    expect(result.ok).toBe(false);
    expect(result.reasons.join("；")).toContain("现货交易权限");
    expect(result.reasons.join("；")).toContain("USDT");
  });

  it("服务器时钟偏差超过阈值时拒绝启动", async () => {
    vi.stubEnv("TRADER_MAX_CLOCK_SKEW_MS", "100");
    mocks.fetchBinanceServerTime.mockResolvedValue({
      serverTime: Date.now() + 5_000,
      localMidpoint: Date.now(),
      roundTripMs: 10,
    });
    const result = await runStartupSelfCheck({ mode: "testnet", ...(await paths()) });
    expect(result.ok).toBe(false);
    expect(result.reasons.join("；")).toContain("时间偏差");
  });

  it("Binance环境与运行模式不一致时拒绝启动", async () => {
    mocks.getServerBinanceSpotMode.mockReturnValue("production");
    const result = await runStartupSelfCheck({ mode: "testnet", ...(await paths()) });
    expect(result.ok).toBe(false);
    expect(result.reasons.join("；")).toContain("必须为 testnet");
    expect(mocks.fetchSignedBinanceRead).not.toHaveBeenCalled();
  });
});
