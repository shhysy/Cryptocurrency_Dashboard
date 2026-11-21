export interface WorkerSelfReference {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface TestnetIntentScanEnv {
  WORKER_SELF_REFERENCE?: WorkerSelfReference;
  DASHBOARD_PASSWORD?: string;
  BINANCE_SPOT_ENVIRONMENT?: string;
  BINANCE_TESTNET_INTENT_CREATION_ENABLED?: string;
  BINANCE_TESTNET_INTENT_SCAN_ENABLED?: string;
  BINANCE_TESTNET_BUY_ENABLED?: string;
  BINANCE_TESTNET_SELL_ENABLED?: string;
}

export type TestnetIntentScanResult =
  | { state: "disabled"; reason: string }
  | { state: "skipped"; reason: string }
  | { state: "scanned"; created: number; intents: unknown[] };

function enabled(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

/**
 * 通过Worker自引用Service Binding调用受保护的Next API路由。
 * Cron只触发服务端策略信号计算/DO intent创建，不直接提交Binance订单。
 */
export async function runTestnetStrategyIntentScan(
  env: TestnetIntentScanEnv,
): Promise<TestnetIntentScanResult> {
  if (env.BINANCE_SPOT_ENVIRONMENT !== "testnet" ||
      env.BINANCE_TESTNET_INTENT_CREATION_ENABLED !== "true" ||
      env.BINANCE_TESTNET_INTENT_SCAN_ENABLED !== "true") {
    return { state: "disabled", reason: "Testnet策略扫描开关未同时启用" };
  }
  if (!enabled(env.BINANCE_TESTNET_BUY_ENABLED) &&
      !enabled(env.BINANCE_TESTNET_SELL_ENABLED)) {
    return { state: "disabled", reason: "Testnet BUY/SELL服务端方向开关均关闭" };
  }
  if (!env.WORKER_SELF_REFERENCE || !env.DASHBOARD_PASSWORD) {
    return { state: "disabled", reason: "Worker自引用绑定或Dashboard认证密码未配置" };
  }

  const origin = "https://cryptocurrency-dashboard";
  const authorization = "Basic " + btoa("cron:" + env.DASHBOARD_PASSWORD);
  const response = await env.WORKER_SELF_REFERENCE.fetch(
    new Request(origin + "/api/execution/intents", {
      method: "POST",
      headers: {
        authorization,
        origin,
        "content-type": "application/json",
      },
      body: "{}",
    }),
  );
  const payload = await response.json().catch(() => ({})) as {
    created?: number;
    intents?: unknown[];
    error?: string;
  };
  if (response.status === 409) {
    return { state: "skipped", reason: payload.error ?? "行情/账户数据未达到执行新鲜度要求" };
  }
  if (!response.ok || !Number.isSafeInteger(payload.created) || !Array.isArray(payload.intents)) {
    throw new Error(`Testnet策略扫描API失败（HTTP ${response.status}）：${payload.error ?? "响应格式无效"}`);
  }
  return { state: "scanned", created: payload.created as number, intents: payload.intents };
}
