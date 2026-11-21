import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getServerBinanceSpotMode, hasCredentials, submitTraderSpotMarketOrder } from "@/lib/binance";
import { getDashboard } from "@/lib/service";
import { binanceReconcileAdapter } from "@/lib/execution/binance-reconcile.server";
import { openLocalExecutionStore } from "@/lib/execution/server/sqlite-store";
import { acquireTraderLock } from "@/lib/execution/server/trader-lock";
import { runTraderCycle, type TraderMode } from "@/lib/execution/server/trader-loop";
import { enqueueServerSellSignals } from "@/lib/execution/server/sell-enqueue";
import { runServerSellCycle } from "@/lib/execution/server/sell-execution";
import { runNotificationOutboxCycle } from "@/lib/execution/server/notification-outbox-dispatcher";
import { parseAutoTradeMode, assertProductionAuthorized } from "@/lib/execution/server/auto-trade-mode";
import { runStartupSelfCheck } from "@/lib/execution/server/startup-self-check";
import { ConsecutiveFailureBreaker } from "@/lib/execution/server/circuit-breaker";
import { redactSecrets, safeError, safeLog } from "@/lib/execution/server/safe-log";
import { buildSystemAlertNotificationEvent } from "@/lib/execution/notification-outbox";
import { isStopFilePresent } from "@/lib/execution/server/stop-file";
import { tradeLedgerToCsv } from "@/lib/execution/csv";

function readPollInterval(): number {
  const value = Number(process.env.TRADER_POLL_INTERVAL_MS ?? "15000");
  if (!Number.isSafeInteger(value) || value < 5_000 || value > 300_000) {
    throw new Error("TRADER_POLL_INTERVAL_MS必须在5000至300000毫秒之间");
  }
  return value;
}

async function stopFileExists(): Promise<boolean> {
  return isStopFilePresent(join(process.cwd(), "data", "STOP"));
}

async function writeStopFile(reason: string): Promise<void> {
  await mkdir(join(process.cwd(), "data"), { recursive: true });
  await writeFile(join(process.cwd(), "data", "STOP"), `${new Date().toISOString()} ${reason}\n`, "utf8");
}

async function syncRealTradeLedgerCsv(store: Awaited<ReturnType<typeof openLocalExecutionStore>>): Promise<void> {
  const path = process.env.TRADER_TRADE_LEDGER_CSV ?? "data/trades.csv";
  await mkdir("data", { recursive: true, mode: 0o700 });
  const entries = await store.tradeLedger.listTradeLedger();
  const temporary = path + ".tmp";
  await writeFile(temporary, "\uFEFF" + tradeLedgerToCsv(entries), { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
  safeLog(`[Trader] 真实成交CSV已从SQLite同步：${entries.length}笔`);
}

async function enqueueCriticalTraderAlert(
  store: Awaited<ReturnType<typeof openLocalExecutionStore>>,
  id: string,
  title: string,
  message: string,
): Promise<void> {
  const occurredAt = Date.now();
  const alert = buildSystemAlertNotificationEvent({
    id,
    title,
    message: redactSecrets(message).slice(0, 1_500),
    occurredAt,
  }, occurredAt);
  const queued = await store.notificationOutbox.enqueueSystemAlert(alert);
  safeLog("[Trader] 安全告警已持久化入队", { created: queued.created, eventId: alert.id });
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
      const stopFilePresent = await stopFileExists();
      const manualReviewCount = await store.countExecutionManualReview();
      if (manualReviewCount > 0 && !stopFilePresent) {
        const reason = `检测到${manualReviewCount}项BUY/SELL订单需要人工复核，自动暂停新交易`;
        await writeStopFile(reason);
        try {
          await enqueueCriticalTraderAlert(
            store,
            `trader-alert:manual-review:${Date.now()}`,
            "Trader检测到订单人工复核",
            reason,
          );
        } catch (alertError) {
          safeError("[Trader] 人工复核告警入队失败；data/STOP已写入：", alertError);
        }
      }
      const stopped = stopFilePresent || manualReviewCount > 0;
      const effectiveMode: TraderMode = stopped ? "off" : mode;
      if (stopped) safeError("[Trader] 检测到STOP或订单人工复核：暂停新信号和新订单，只继续只读对账");
      try {
        const result = await runTraderCycle({
          mode: effectiveMode,
          store,
          getDashboard,
          adapter: binanceReconcileAdapter,
          submitOrder: submitTraderSpotMarketOrder,
          log: (message) => safeLog(`[Trader] ${message}`),
        });
        if (result.manualReview > 0 && !stopped) {
          const reason = `订单对账产生${result.manualReview}项人工复核，自动暂停新交易`;
          await writeStopFile(reason);
          try {
            await enqueueCriticalTraderAlert(
              store,
              `trader-alert:manual-review:${Date.now()}`,
              "Trader订单对账需要人工复核",
              reason,
            );
          } catch (alertError) {
            safeError("[Trader] 对账人工复核告警入队失败；data/STOP已写入：", alertError);
          }
        }
        let dash: Awaited<ReturnType<typeof getDashboard>> | null = null;
        if (effectiveMode !== "off" && result.manualReview === 0) {
          dash = await getDashboard();
          const sell = await enqueueServerSellSignals(dash, store);
          safeLog("[Trader] SELL入队", sell);
        }
        const sellMode: TraderMode = result.manualReview > 0 ? "off" : effectiveMode;
        try {
          // STOP/off/人工复核只禁止新SELL；已有订单仍继续只读恢复。
          const execution = await runServerSellCycle({
            mode: sellMode,
            store,
            adapter: binanceReconcileAdapter,
            dashboard: dash,
            submitOrder: submitTraderSpotMarketOrder,
            log: (message) => safeLog(`[Trader] ${message}`),
          });
          safeLog("[Trader] SELL执行/对账", execution);
          if (execution.blocked > 0 && !stopped && result.manualReview === 0) {
            const reason = `SELL执行链路有${execution.blocked}项被阻断并转人工复核，自动暂停新交易`;
            await writeStopFile(reason);
            try {
              await enqueueCriticalTraderAlert(
                store,
                `trader-alert:sell-blocked:${Date.now()}`,
                "Trader SELL执行需要人工复核",
                reason,
              );
            } catch (alertError) {
              safeError("[Trader] SELL人工复核告警入队失败；data/STOP已写入：", alertError);
            }
          }
        } catch (sellError) {
          safeError("[Trader] SELL执行链路失败，计入连续故障熔断", sellError);
          throw sellError;
        }
        await syncRealTradeLedgerCsv(store);
        const outbox = await runNotificationOutboxCycle(store);
        safeLog("[Trader] 成交通知Outbox", outbox);
        if (outbox.failed > 0) safeError(`[Trader] 通知Outbox有${outbox.failed}项投递失败，已进入持久化退避重试；不因此中断交易循环`);
        breaker.recordSuccess();
        safeLog("[Trader] 本轮结果", result);
      } catch (error) {
        safeError("[Trader] 本轮失败；不会自动重发任何未知订单：", error);
        if (breaker.recordFailure()) {
          const reason = redactSecrets(error instanceof Error ? error.message : "未知异常").slice(0, 1_500);
          await writeStopFile(`连续失败达到阈值 ${breaker.count}`);
          safeError("[Trader] 已触发熔断并写入 data/STOP");
          try {
            await enqueueCriticalTraderAlert(
              store,
              `trader-alert:circuit-breaker:${Date.now()}`,
              "Trader连续故障熔断",
              `连续失败达到阈值 ${breaker.count}。最近一次失败：${reason}`,
            );
          } catch (alertError) {
            safeError("[Trader] 熔断告警入队失败；data/STOP已写入，需人工检查本地日志：", alertError);
          }
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
