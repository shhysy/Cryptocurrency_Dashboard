import { buildBinanceReconcilePlan } from "./binance-reconcile-plan.server";
import type { createBinanceReconcileAdapter } from "./binance-reconcile.server";

type ReconcileAdapter = ReturnType<typeof createBinanceReconcileAdapter>;

export interface ClaimedReconcileTask {
  taskId: string;
  taskType: "reconcile_intent";
  dueAt: number;
  attempt: number;
  leaseToken: string;
  leaseUntil: number;
}

export interface InternalCoordinator {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface ReconcileContext {
  intentId: string;
  state: string;
  symbol: string;
  side: "BUY" | "SELL";
  clientOrderId: string;
  attempt: number;
  leaseToken: string;
  leaseUntil: number;
  terminal: boolean;
}

async function postJson(
  coordinator: InternalCoordinator,
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const response = await coordinator.fetch(`https://execution.internal${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

async function getJson(
  coordinator: InternalCoordinator,
  path: string,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const response = await coordinator.fetch(`https://execution.internal${path}`);
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

/**
 * 消费一个reconcile_intent调度任务。所有外部Binance请求均为GET；
 * 写入finalize前同时续期账户租约与调度租约，DO最终事务还会再次核对两者。
 */
export async function dispatchReconcileIntentTask(
  coordinator: InternalCoordinator,
  task: ClaimedReconcileTask,
  adapter: ReconcileAdapter,
  now = Date.now(),
): Promise<"completed" | "retry_scheduled" | "lease_lost"> {
  if (task.taskType !== "reconcile_intent" || task.taskId.length > 160 ||
      !Number.isSafeInteger(task.attempt) || task.attempt <= 0 ||
      !task.leaseToken || !Number.isSafeInteger(task.leaseUntil)) {
    return "lease_lost";
  }

  const contextResult = await getJson(
    coordinator,
    `/internal/reconcile-context?intentId=${encodeURIComponent(task.taskId)}`,
  );
  if (!contextResult.ok) {
    await postJson(coordinator, "/internal/scheduler/retry", {
      taskId: task.taskId, attempt: task.attempt, leaseToken: task.leaseToken,
      reason: `读取订单对账上下文失败：HTTP ${contextResult.status}`,
    });
    return "retry_scheduled";
  }
  const context = contextResult.data as unknown as ReconcileContext;
  if (context.intentId !== task.taskId) {
    await postJson(coordinator, "/internal/scheduler/retry", {
      taskId: task.taskId, attempt: task.attempt, leaseToken: task.leaseToken,
      reason: "对账上下文intentId与任务ID不匹配",
    });
    return "retry_scheduled";
  }

  if (context.terminal) {
    const ack = await postJson(coordinator, "/internal/scheduler/ack", {
      taskId: task.taskId, attempt: task.attempt, leaseToken: task.leaseToken,
    });
    return ack.ok ? "completed" : "lease_lost";
  }

  if (!["submitting", "unknown", "reconciling"].includes(context.state) ||
      !context.clientOrderId || !context.leaseToken ||
      !Number.isSafeInteger(context.attempt) || context.attempt <= 0) {
    await postJson(coordinator, "/internal/scheduler/retry", {
      taskId: task.taskId, attempt: task.attempt, leaseToken: task.leaseToken,
      reason: "订单不处于可只读对账状态或缺少原clientOrderId/账户租约",
    });
    return "retry_scheduled";
  }

  let accountLeaseToken = context.leaseToken;
  if (context.leaseUntil <= now) {
    const takeover = await postJson(coordinator, "/internal/takeover", {
      intentId: context.intentId, attempt: context.attempt, leaseToken: accountLeaseToken,
    });
    if (!takeover.ok || typeof takeover.data.leaseToken !== "string") {
      await postJson(coordinator, "/internal/scheduler/retry", {
        taskId: task.taskId, attempt: task.attempt, leaseToken: task.leaseToken,
        reason: "账户租约接管失败，等待下一轮只读恢复",
      });
      return "retry_scheduled";
    }
    accountLeaseToken = takeover.data.leaseToken;
  } else {
    const renewed = await postJson(coordinator, "/internal/renew-lease", {
      intentId: context.intentId, attempt: context.attempt, leaseToken: accountLeaseToken,
    });
    if (!renewed.ok) {
      await postJson(coordinator, "/internal/scheduler/retry", {
        taskId: task.taskId, attempt: task.attempt, leaseToken: task.leaseToken,
        reason: "账户租约续期失败，等待重新接管",
      });
      return "retry_scheduled";
    }
  }

  const plan = await buildBinanceReconcilePlan(adapter, {
    symbol: context.symbol,
    clientOrderId: context.clientOrderId,
    expectedSide: context.side,
  });

  if (plan.kind !== "finalize") {
    await postJson(coordinator, "/internal/scheduler/retry", {
      taskId: task.taskId,
      attempt: task.attempt,
      leaseToken: task.leaseToken,
      reason: plan.reason,
    });
    return "retry_scheduled";
  }

  // 防止长时间Binance GET导致调度租约过期后仍执行finalize。
  const schedulerRenewed = await postJson(coordinator, "/internal/scheduler/renew", {
    taskId: task.taskId, attempt: task.attempt, leaseToken: task.leaseToken,
  });
  if (!schedulerRenewed.ok) return "lease_lost";

  const accountRenewed = await postJson(coordinator, "/internal/renew-lease", {
    intentId: context.intentId, attempt: context.attempt, leaseToken: accountLeaseToken,
  });
  if (!accountRenewed.ok) return "lease_lost";

  const finalized = await postJson(coordinator, "/internal/finalize", {
    intentId: context.intentId,
    attempt: context.attempt,
    leaseToken: accountLeaseToken,
    exchangeOrderId: plan.exchangeOrderId,
    exchangeStatus: plan.exchangeStatus,
    executedQty: plan.executedQty,
    cumulativeQuoteQty: plan.cumulativeQuoteQty,
    exchangeTerminalAt: plan.exchangeTerminalAt,
    fills: plan.fills,
    schedulerTaskId: task.taskId,
    schedulerAttempt: task.attempt,
    schedulerLeaseToken: task.leaseToken,
  });
  if (!finalized.ok) {
    await postJson(coordinator, "/internal/scheduler/retry", {
      taskId: task.taskId, attempt: task.attempt, leaseToken: task.leaseToken,
      reason: typeof finalized.data.error === "string" ? finalized.data.error : "DO终态结算拒绝",
    });
    return "retry_scheduled";
  }

  const ack = await postJson(coordinator, "/internal/scheduler/ack", {
    taskId: task.taskId, attempt: task.attempt, leaseToken: task.leaseToken,
  });
  return ack.ok ? "completed" : "lease_lost";
}
