import type { DashboardData } from "@/lib/types";
import { strategyConfig } from "@/strategy.config";
import { buildBinanceReconcilePlan } from "../binance-reconcile-plan.server";
import type { createBinanceReconcileAdapter } from "../binance-reconcile.server";
import type { SpotMarketOrderResponse } from "@/lib/binance";
import {
  serverExecutionIntentId,
  type ServerExecutionIntent,
} from "../server-execution-core";
import type { IntentClaimResult, LocalExecutionStore } from "./store";

export type TraderMode = "off" | "dry-run" | "testnet" | "production";
type ReconcileAdapter = ReturnType<typeof createBinanceReconcileAdapter>;

export interface TraderCycleDependencies {
  mode: TraderMode;
  store: LocalExecutionStore;
  getDashboard: () => Promise<DashboardData>;
  adapter: ReconcileAdapter;
  submitOrder: (input: {
    side: "BUY" | "SELL";
    symbol: string;
    amount: string;
    clientOrderId: string;
  }) => Promise<SpotMarketOrderResponse>;
  now?: () => number;
  log?: (message: string) => void;
}

export interface TraderCycleResult {
  mode: TraderMode;
  signalsCreated: number;
  existingSignals: number;
  submitted: number;
  unknown: number;
  reconciled: number;
  retried: number;
  manualReview: number;
  skippedReason?: string;
}

const BUY_KINDS = new Set(["head", "add", "reserve"]);
const TERMINAL_STATES = new Set([
  "filled", "partial_terminal", "canceled", "expired", "rejected", "manual_review",
]);

/** 只把新鲜、可执行的策略3.3 BUY信号转成服务端intent；不触碰浏览器IndexedDB。 */
export function buildServerBuyIntents(
  data: DashboardData,
): ServerExecutionIntent[] {
  if (data.source !== "binance" || data.stale || !data.market.accountKnown ||
      !Number.isSafeInteger(data.updatedAt) || data.updatedAt <= 0) return [];

  const intents: ServerExecutionIntent[] = [];
  for (const coin of data.coins) {
    const action = coin.signal.action;
    if (action.side !== "buy" || !BUY_KINDS.has(action.kind) ||
        !Array.isArray(action.blocked) || action.blocked.length > 0 ||
        !Number.isFinite(action.usdt) || (action.usdt ?? 0) <= 0 ||
        !Number.isFinite(coin.price) || coin.price <= 0) continue;

    const sourceWeek = coin.series.length >= 2
      ? coin.series[coin.series.length - 2]?.t
      : coin.series[coin.series.length - 1]?.t;
    if (!Number.isSafeInteger(sourceWeek) || (sourceWeek as number) <= 0) continue;

    const profile = strategyConfig.profiles[
      strategyConfig.coreSymbols.includes(coin.symbol) ? "core" : "alt"
    ];
    const strategyEventId = [
      coin.symbol, action.kind, action.label || "buy", String(sourceWeek),
    ].join(":");
    intents.push({
      intentId: serverExecutionIntentId(strategyEventId),
      strategyEventId,
      strategyVersion: "3.3",
      symbol: `${coin.symbol}USDT`,
      side: "BUY",
      quoteAsset: "USDT",
      amount: String(action.usdt),
      baseRatioAtSignal: profile.baseRatio,
      state: "queued",
      attempt: 0,
      createdAt: data.updatedAt,
      updatedAt: data.updatedAt,
      exchangeOrderId: null,
      clientOrderId: null,
      exchangeTerminalAt: null,
      fillsReconciledAt: null,
      lastError: null,
    });
  }
  return intents;
}

function isTerminalState(state: string): boolean {
  return TERMINAL_STATES.has(state);
}

async function reconcileDueTasks(
  deps: TraderCycleDependencies,
  now: () => number,
): Promise<Pick<TraderCycleResult, "reconciled" | "retried" | "manualReview">> {
  const tasks = await deps.store.scheduler.claimDue({
    now: now(), leaseMs: 30_000, limit: 10, taskType: "reconcile_intent",
  });
  let reconciled = 0;
  let retried = 0;
  let manualReview = 0;

  for (const task of tasks) {
    const intentId = task.taskId.startsWith("reconcile:")
      ? task.taskId.slice("reconcile:".length)
      : "";
    if (!intentId || task.taskId !== `reconcile:${intentId}`) {
      await deps.store.scheduler.retry(task, now(), "对账任务ID格式无效");
      retried += 1;
      continue;
    }

    let context = await deps.store.getReconcileContext(intentId);
    if (!context) {
      await deps.store.scheduler.retry(task, now(), "找不到对账订单上下文");
      retried += 1;
      continue;
    }
    if (isTerminalState(context.intent.state)) {
      await deps.store.scheduler.ack(task, now());
      continue;
    }
    if (!["submitting", "unknown", "reconciling"].includes(context.intent.state) ||
        !context.intent.clientOrderId || !context.lease) {
      const retry = await deps.store.scheduler.retry(task, now(), "订单不处于只读对账状态或缺少原clientOrderId/账户租约");
      if (retry === "manual_review") manualReview += 1;
      else retried += 1;
      continue;
    }

    let accountLease = context.lease;
    const leaseNow = now();
    if (accountLease.leaseUntil <= leaseNow) {
      const taken = await deps.store.takeoverForReconciliation({
        intentId,
        attempt: accountLease.attempt,
        leaseToken: accountLease.token,
        now: leaseNow,
      }, 30_000);
      if (!taken) {
        await deps.store.scheduler.retry(task, now(), "账户租约接管失败，等待下一轮只读恢复");
        retried += 1;
        continue;
      }
      accountLease = taken;
    } else {
      const renewed = await deps.store.renewExecutionLease({
        intentId,
        attempt: accountLease.attempt,
        leaseToken: accountLease.token,
        now: leaseNow,
      }, 30_000);
      if (!renewed) {
        await deps.store.scheduler.retry(task, now(), "账户租约续期失败");
        retried += 1;
        continue;
      }
    }

    const plan = await buildBinanceReconcilePlan(deps.adapter, {
      symbol: context.intent.symbol,
      clientOrderId: context.intent.clientOrderId,
      expectedSide: context.intent.side,
    });
    if (plan.kind === "manual_review") {
      await deps.store.markManualReview({
        intentId, attempt: accountLease.attempt, leaseToken: accountLease.token,
        now: now(), reason: plan.reason,
      });
      await deps.store.scheduler.ack(task, now());
      manualReview += 1;
      continue;
    }
    if (plan.kind !== "finalize") {
      const retry = await deps.store.scheduler.retry(task, now(), plan.reason);
      if (retry === "manual_review") {
        await deps.store.markManualReview({
          intentId, attempt: accountLease.attempt, leaseToken: accountLease.token,
          now: now(), reason: plan.reason,
        });
        manualReview += 1;
      } else {
        retried += 1;
      }
      continue;
    }

    const schedulerRenewed = await deps.store.scheduler.renew(task, now(), 30_000);
    if (!schedulerRenewed) {
      retried += 1;
      continue;
    }
    const accountRenewed = await deps.store.renewExecutionLease({
      intentId, attempt: accountLease.attempt, leaseToken: accountLease.token, now: now(),
    }, 30_000);
    if (!accountRenewed) {
      await deps.store.scheduler.retry(task, now(), "终态写入前账户租约续期失败");
      retried += 1;
      continue;
    }

    try {
      await deps.store.finalizeReconciledOrder({
        intentId,
        attempt: accountLease.attempt,
        leaseToken: accountLease.token,
        now: now(),
        exchangeOrderId: plan.exchangeOrderId,
        exchangeStatus: plan.exchangeStatus,
        executedQty: plan.executedQty,
        cumulativeQuoteQty: plan.cumulativeQuoteQty,
        exchangeTerminalAt: plan.exchangeTerminalAt,
        schedulerLease: task,
        fills: plan.fills,
      });
      if (await deps.store.scheduler.ack(task, now())) reconciled += 1;
      else retried += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "本地终态结算失败";
      const retry = await deps.store.scheduler.retry(task, now(), reason);
      if (retry === "manual_review") {
        await deps.store.markManualReview({
          intentId, attempt: accountLease.attempt, leaseToken: accountLease.token,
          now: now(), reason,
        });
        manualReview += 1;
      } else {
        retried += 1;
      }
    }
  }

  return { reconciled, retried, manualReview };
}

/** 单轮执行：先只读恢复旧订单，再扫描新信号；POST始终先落submitting与原clientOrderId。 */
export async function runTraderCycle(
  deps: TraderCycleDependencies,
): Promise<TraderCycleResult> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);
  if (deps.mode === "production") {
    throw new Error("生产模式尚未完成M3-01独立授权、自检与熔断验收，当前拒绝启动真实交易");
  }

  const reconciled = await reconcileDueTasks(deps, now);
  const result: TraderCycleResult = {
    mode: deps.mode,
    signalsCreated: 0,
    existingSignals: 0,
    submitted: 0,
    unknown: 0,
    ...reconciled,
  };
  if (deps.mode === "off") return result;

  const dashboard = await deps.getDashboard();
  if (dashboard.source !== "binance" || dashboard.stale || !dashboard.market.accountKnown) {
    result.skippedReason = dashboard.source !== "binance"
      ? "行情数据不是Binance真实数据"
      : dashboard.stale ? "行情数据STALE，禁止生成新订单" : "账户余额未知，禁止生成新订单";
    return result;
  }

  for (const intent of buildServerBuyIntents(dashboard)) {
    const created = await deps.store.createIntent(intent);
    if (created.created) result.signalsCreated += 1;
    else result.existingSignals += 1;
  }

  if (deps.mode === "dry-run") {
    log(`dry-run：新增${result.signalsCreated}个BUY意图，未领取资金、未提交订单`);
    return result;
  }

  const pending = await deps.store.listRunnableIntents(now(), 10);
  if (pending.length === 0) return result;
  const balances = await deps.adapter.getAccountBalances();
  const usdt = balances.find((balance) => balance.asset === "USDT");
  const available = usdt?.free ?? "0";
  const snapshotAt = now();

  for (const intent of pending) {
    let claim: IntentClaimResult | null;
    try {
      claim = await deps.store.claimIntent({
        intentId: intent.intentId,
        availableAsset: "USDT",
        availableAmount: available,
        snapshotAt,
        now: now(),
        leaseMs: 30_000,
      });
    } catch (error) {
      log(`BUY意图领取失败 ${intent.intentId}: ${error instanceof Error ? error.message : "未知错误"}`);
      continue;
    }
    if (!claim) continue;

    const clientOrderId = claim.intent.clientOrderId;
    if (!clientOrderId) throw new Error("本地资金预留成功但缺少clientOrderId，停止Trader并人工检查");
    await deps.store.markSubmitting({
      intentId: intent.intentId,
      attempt: claim.lease.attempt,
      leaseToken: claim.lease.token,
      clientOrderId,
      now: now(),
    });

    try {
      await deps.submitOrder({
        side: "BUY",
        symbol: intent.symbol,
        amount: intent.amount,
        clientOrderId,
      });
      result.submitted += 1;
      log(`Testnet BUY已返回受理响应：${intent.symbol}，clientOrderId=${clientOrderId}；等待只读查单与成交核对`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "下单请求结果不明确";
      try {
        await deps.store.markUnknown({
          intentId: intent.intentId,
          attempt: claim.lease.attempt,
          leaseToken: claim.lease.token,
          reason,
          now: now(),
        });
      } catch (markError) {
        log(`订单已进入submitting但unknown写入失败，保持账户锁并停止自动提交：${markError instanceof Error ? markError.message : "未知错误"}`);
        throw markError;
      }
      result.unknown += 1;
      log(`BUY结果未知，已冻结原clientOrderId并排队只读对账；禁止重发：${clientOrderId}`);
    }
  }
  return result;
}
