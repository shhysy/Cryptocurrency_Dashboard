import { access, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getServerBinanceSpotMode, hasCredentials, submitSpotMarketOrder } from "@/lib/binance";
import { getDashboard } from "@/lib/service";
import { binanceReconcileAdapter } from "@/lib/execution/binance-reconcile.server";
import { openLocalExecutionStore } from "@/lib/execution/server/sqlite-store";
import { acquireTraderLock } from "@/lib/execution/server/trader-lock";
import { runTraderCycle, type TraderMode } from "@/lib/execution/server/trader-loop";
import { enqueueServerSellSignals } from "@/lib/execution/server/sell-enqueue";
import { parseAutoTradeMode, assertProductionAuthorized } from "@/lib/execution/server/auto-trade-mode";
import { runStartupSelfCheck } from "@/lib/execution/server/startup-self-check";
import { ConsecutiveFailureBreaker } from "@/lib/execution/server/circuit-breaker";
import { safeError, safeLog } from "@/lib/execution/server/safe-log";

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

async function writeStopFile(reason: string): Promise<void> {
  await mkdir(join(process.cwd(), "data"), { recursive: true });
  await writeFile(join(process.cwd(), "data", "STOP"), `${new Date().toISOString()} ${reason}\n`, "utf8");
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
  const mode = parseAutoTradeMode(process.env.AUTO_TRADE_MODE) as TraderMode;
  assertProductionAuthorized();
  const pollInterval = readPollInterval();
  const failThreshold = Number(process.env.TRADER_CIRCUIT_FAILURES ?? "5");
  const breaker = new ConsecutiveFailureBreaker(
    Number.isSafeInteger(failThreshold) && failThreshold > 0 ? failThreshold : 5,
  );

  if (mode === "production") {
    throw new Error("生产模式尚未完成独立验收；当前明确拒绝真实资金交易");
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

  const selfCheck = await runStartupSelfCheck({
    mode,
    dbPath: process.env.TRADER_DB_PATH ?? "data/trader.db",
    dataDir: "data",
  });
  if (!selfCheck.ok) {
    throw new Error(`启动自检失败：${selfCheck.reasons.join("；")}`);
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
    safeLog(`[Trader] 已启动 mode=${mode}；单实例锁已获取`);

    while (!controller.signal.aborted) {
      const stopped = await stopFileExists();
      const effectiveMode: TraderMode = stopped ? "off" : mode;
      if (stopped) safeError("[Trader] 检测到data/STOP：暂停新信号和新订单，只继续只读对账");
      try {
        const result = await runTraderCycle({
          mode: effectiveMode,
          store,
          getDashboard,
          adapter: binanceReconcileAdapter,
          submitOrder: submitSpotMarketOrder,
          log: (message) => safeLog(`[Trader] ${message}`),
        });
        if (effectiveMode !== "off") {
          try {
            const dash = await getDashboard();
            const sell = await enqueueServerSellSignals(dash, store);
            safeLog("[Trader] SELL入队", sell);
          } catch (sellError) {
            safeError("[Trader] SELL入队失败（不中断BUY对账）", sellError);
          }
        }
        breaker.recordSuccess();
        safeLog("[Trader] 本轮结果", result);
      } catch (error) {
        safeError("[Trader] 本轮失败；不会自动重发任何未知订单：", error);
        if (breaker.recordFailure()) {
          await writeStopFile(`连续失败达到阈值 ${breaker.count}`);
          safeError("[Trader] 已触发熔断并写入 data/STOP");
        }
      }
      await sleep(pollInterval, controller.signal);
    }
  } finally {
    process.removeListener("SIGINT", onStop);
    process.removeListener("SIGTERM", onStop);
    try {
      store?.close();
    } finally {
      await lock.release();
    }
    safeLog("[Trader] 已停止，SQLite连接和单实例锁已释放");
  }
}

main().catch((error) => {
  safeError("[Trader] 启动失败：", error);
  process.exitCode = 1;
});
