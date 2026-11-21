// OpenNext在build:cf时生成此模块；不要直接修改 .open-next/worker.js。
// @ts-ignore OpenNext在Cloudflare构建时生成该入口模块
import openNextWorker from "./.open-next/worker.js";
import { ExecutionAccountDO } from "./lib/execution/execution-account-do";
import { binanceReconcileAdapter } from "./lib/execution/binance-reconcile.server";
import {
  dispatchReconcileIntentTask,
  type ClaimedReconcileTask,
} from "./lib/execution/reconcile-intent-dispatcher.server";
import {
  runTestnetStrategyIntentScan,
  type TestnetIntentScanEnv,
} from "./lib/execution/strategy-intent-cron.server";

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

interface DurableObjectIdLike {}
interface DurableObjectStubLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
interface DurableObjectNamespaceLike {
  idFromName(name: string): DurableObjectIdLike;
  get(id: DurableObjectIdLike): DurableObjectStubLike;
}

interface WorkerEnv extends TestnetIntentScanEnv {
  EXECUTION_ACCOUNT: DurableObjectNamespaceLike;
}

export { ExecutionAccountDO };

export default {
  fetch(request: Request, env: WorkerEnv, ctx: WorkerExecutionContext): Promise<Response> | Response {
    return openNextWorker.fetch(request, env, ctx);
  },

  scheduled(
    controller: { scheduledTime: number; cron: string },
    env: WorkerEnv,
    ctx: WorkerExecutionContext,
  ): void {
    const accountId = env.EXECUTION_ACCOUNT.idFromName("binance-spot-primary");
    const coordinator = env.EXECUTION_ACCOUNT.get(accountId);
    ctx.waitUntil((async () => {
      const watchdog = await coordinator.fetch("https://execution.internal/internal/watchdog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scheduledTime: controller.scheduledTime,
          cron: controller.cron,
        }),
      });
      if (!watchdog.ok) throw new Error(`DO watchdog failed: HTTP ${watchdog.status}`);

      // 只有独立Testnet扫描开关、intent开关和至少一个方向开关开启时，
      // 才通过Worker自引用Service Binding调用受保护的服务端策略计算入口。
      try {
        const scan = await runTestnetStrategyIntentScan(env);
        if (scan.state === "scanned" && scan.created > 0) {
          console.info("[strategy-intent-scan]", `created=${scan.created}`);
        }
      } catch (error) {
        console.error("[strategy-intent-scan]", error instanceof Error ? error.message : "Testnet策略扫描失败");
      }

      // Cron在页面关闭后持续领取并执行只读reconcile_intent任务。
      // 订单POST能力不在此调度器中；所有不确定状态只查原clientOrderId。
      const claimed = await coordinator.fetch("https://execution.internal/internal/scheduler/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 5, taskType: "reconcile_intent" }),
      });
      if (!claimed.ok) throw new Error(`DO scheduler claim failed: HTTP ${claimed.status}`);
      const payload = await claimed.json() as { tasks?: ClaimedReconcileTask[] };
      if (!Array.isArray(payload.tasks)) throw new Error("DO scheduler claim response is invalid");
      for (const task of payload.tasks) {
        await dispatchReconcileIntentTask(coordinator, task, binanceReconcileAdapter);
      }
    })().catch((error) => {
      console.error("[execution-scheduler]", error instanceof Error ? error.message : "后台对账调度失败");
    }));
  },
};
