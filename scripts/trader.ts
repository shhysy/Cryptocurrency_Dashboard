import { access } from "node:fs/promises";
import { join } from "node:path";
import { getServerBinanceSpotMode, hasCredentials, submitSpotMarketOrder } from "@/lib/binance";
import { getDashboard } from "@/lib/service";
import { binanceReconcileAdapter } from "@/lib/execution/binance-reconcile.server";
import { openLocalExecutionStore } from "@/lib/execution/server/sqlite-store";
import { acquireTraderLock } from "@/lib/execution/server/trader-lock";
import { runTraderCycle, type TraderMode } from "@/lib/execution/server/trader-loop";

function readMode(): TraderMode {
  const value = process.env.AUTO_TRADE_MODE ?? "off";
  if (value !== "off" && value !== "dry-run" && value !== "testnet" && value !== "production") {
    throw new Error("AUTO_TRADE_MODE只允许off、dry-run、testnet、production");
  }
  return value;
}

function readPollInterval(): number {
  const value = Number(process.env.TRADER_POLL_INTERVAL_MS ?? "15000");
  if (!Number.isSafeInteger(value) || value < 5_000 || value > 300_000) {
    throw new Error("TRADER_POLL_INTERVAL_MS必须在5000至300000毫秒之间");
  }
  return value;
}

async function stopFileExists(): Promise<boolean> {
  try {
    await access(join(process.cwd(), "data", "STOP"));
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolveSleep) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolveSleep();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

async function main(): Promise<void> {
  const mode = readMode();
  const pollInterval = readPollInterval();
  if (mode === "production") {
    throw new Error("生产模式尚未完成M3-01/02/03独立验收；当前明确拒绝真实资金交易");
  }
  if (mode === "testnet") {
    if (getServerBinanceSpotMode() !== "testnet") {
      throw new Error("AUTO_TRADE_MODE=testnet时，BINANCE_SPOT_ENVIRONMENT必须为testnet");
    }
    if (process.env.BINANCE_TESTNET_BUY_ENABLED !== "1") {
      throw new Error("Testnet BUY服务端开关未启用；拒绝启动自动买入");
    }
    if (process.env.ENABLE_ACCOUNT === "0" || !hasCredentials()) {
      throw new Error("Testnet自动交易需要启用账户读取并配置专用Testnet Key/Secret");
    }
  }

  const lock = await acquireTraderLock({
    path: process.env.TRADER_LOCK_PATH ?? "data/trader.lock",
    heartbeatMs: 10_000,
    staleAfterMs: 45_000,
  });
  let store: Awaited<ReturnType<typeof openLocalExecutionStore>> | null = null;
  const controller = new AbortController();
  const onStop = () => controller.abort();
  process.once("SIGINT", onStop);
  process.once("SIGTERM", onStop);

  try {
    store = await openLocalExecutionStore({
      path: process.env.TRADER_DB_PATH ?? "data/trader.db",
    });
    console.log(`[Trader] 已启动 mode=${mode}；数据库=${process.env.TRADER_DB_PATH ?? "data/trader.db"}；单实例锁已获取`);
    console.log("[Trader] 当前阶段只接入BUY自动执行；SELL等待Grok完成M1-04服务端适配；生产模式强制关闭");

    while (!controller.signal.aborted) {
      const stopped = await stopFileExists();
      const effectiveMode: TraderMode = stopped ? "off" : mode;
      if (stopped) console.error("[Trader] 检测到data/STOP：暂停新信号和新订单，只继续只读对账");
      try {
        const result = await runTraderCycle({
          mode: effectiveMode,
          store,
          getDashboard,
          adapter: binanceReconcileAdapter,
          submitOrder: submitSpotMarketOrder,
          log: (message) => console.log(`[Trader] ${message}`),
        });
        console.log("[Trader] 本轮结果", JSON.stringify(result));
      } catch (error) {
        console.error("[Trader] 本轮失败；不会自动重发任何未知订单：",
          error instanceof Error ? error.message : "未知错误");
      }
      await sleep(pollInterval, controller.signal);
    }
  } finally {
    process.removeListener("SIGINT", onStop);
    process.removeListener("SIGTERM", onStop);
    store?.close();
    await lock.release();
    console.log("[Trader] 已停止，SQLite连接和单实例锁已释放");
  }
}

main().catch((error) => {
  console.error("[Trader] 启动失败：", error instanceof Error ? error.message : "未知错误");
  process.exitCode = 1;
});
