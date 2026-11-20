// OpenNext在build:cf时生成此模块；不要直接修改 .open-next/worker.js。
// @ts-ignore OpenNext在Cloudflare构建时生成该入口模块
import openNextWorker from "./.open-next/worker.js";
import { ExecutionAccountDO } from "./lib/execution/execution-account-do";

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

interface WorkerEnv {
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
    ctx.waitUntil(coordinator.fetch("https://execution.internal/internal/watchdog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scheduledTime: controller.scheduledTime,
        cron: controller.cron,
      }),
    }));
  },
};
