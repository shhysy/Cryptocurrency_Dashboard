import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const port = 8799;
const base = `http://127.0.0.1:${port}`;
const persist = await mkdtemp(join(tmpdir(), "cryptodash-do-sqlite-"));
let child;
let childLogs = "";

function startWorker() {
  childLogs = "";
  child = spawn(process.execPath, [
    "node_modules/wrangler/bin/wrangler.js", "dev",
    "--config", "wrangler.test.jsonc",
    "--local",
    "--ip", "127.0.0.1",
    "--port", String(port),
    "--persist-to", persist,
    "--log-level", "error",
  ], {
    cwd: process.cwd(),
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout.on("data", (chunk) => { childLogs += chunk.toString(); });
  child.stderr.on("data", (chunk) => { childLogs += chunk.toString(); });
}

async function stopWorker() {
  if (!child || child.exitCode !== null) return;
  const current = child;
  // Wrangler启动workerd子进程；杀整个进程组，避免CI脚本退出后遗留监听端口。
  try { process.kill(-current.pid, "SIGTERM"); } catch {}
  await Promise.race([
    new Promise((resolve) => current.once("exit", resolve)),
    delay(5_000),
  ]);
  try { process.kill(-current.pid, "SIGKILL"); } catch {}
  current.stdout?.destroy();
  current.stderr?.destroy();
}

async function waitForWorker() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`wrangler dev提前退出：\n${childLogs}`);
    try {
      const response = await fetch(base + "/health", { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {}
    await delay(500);
  }
  throw new Error(`等待wrangler dev启动超时：\n${childLogs}`);
}

async function request(path, body, method = "POST") {
  const response = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  console.log("[DO SQLite] 启动本地Cloudflare Worker");
  startWorker();
  await waitForWorker();
  console.log("[DO SQLite] Worker已启动，开始创建订单意图");

  const now = Date.now();
  const intentId = "v33:sqlite-restart-intent";
  const create = await request("/internal/intents", {
    intentId,
    strategyEventId: "sqlite-restart-intent",
    strategyVersion: "3.3",
    symbol: "BTCUSDT",
    side: "BUY",
    quoteAsset: "USDT",
    amount: "10",
    createdAt: now,
  });
  assert(create.status === 201 || create.status === 200, `intent创建失败：${JSON.stringify(create)}`);

  const claim = await request("/internal/claim", {
    intentId, asset: "USDT", availableBalance: "100", snapshotAt: Date.now(),
  });
  assert(claim.status === 200, `账户预留领取失败：${JSON.stringify(claim)}`);
  const accountLease = claim.payload;
  assert(typeof accountLease.leaseToken === "string" && accountLease.leaseToken.length >= 16,
    "DO未返回账户租约token");

  const submitting = await request("/internal/mark-submitting", {
    intentId, attempt: accountLease.attempt, leaseToken: accountLease.leaseToken,
  });
  assert(submitting.status === 200, `提交前状态持久化失败：${JSON.stringify(submitting)}`);

  const dueAt = Date.now();
  console.log("[DO SQLite] 订单submitting与reconcile任务已持久化，开始测试scheduler队列");
  const enqueue = await request("/internal/scheduler/enqueue", {
    taskId: "health:sqlite-restart",
    taskType: "health_check",
    dueAt,
  });
  assert(enqueue.status === 201, `调度任务入队失败：${JSON.stringify(enqueue)}`);
  const duplicateSame = await request("/internal/scheduler/enqueue", {
    taskId: "health:sqlite-restart",
    taskType: "health_check",
    dueAt,
  });
  assert(duplicateSame.status === 200 && duplicateSame.payload.created === false,
    "完全相同的重复enqueue未保持幂等");
  const duplicateConflict = await request("/internal/scheduler/enqueue", {
    taskId: "health:sqlite-restart",
    taskType: "health_check",
    dueAt: dueAt + 1,
  });
  // 同taskId但内容不同必须冲突，不能静默覆盖。
  assert(duplicateConflict.status === 409, "相同taskId不同内容未被拒绝");

  const taskClaim = await request("/internal/scheduler/claim", { taskType: "health_check", limit: 1 });
  assert(taskClaim.status === 200 && taskClaim.payload.tasks?.length === 1,
    `调度任务领取失败：${JSON.stringify(taskClaim)}`);
  const schedulerLease = taskClaim.payload.tasks[0];
  assert(schedulerLease.taskId === "health:sqlite-restart", "领取到非预期调度任务");

  const healthBefore = await request("/internal/health", undefined, "GET");
  assert(healthBefore.status === 200 && healthBefore.payload.storage === "sqlite",
    "Durable Object未使用SQLite存储");
  assert(typeof healthBefore.payload.alarmAt === "number", "调度任务未持久化DO Alarm");

  console.log("[DO SQLite] 首次运行完成，停止并重启Worker验证持久化");
  await stopWorker();
  startWorker();
  await waitForWorker();
  console.log("[DO SQLite] Worker已重启，验证订单与租约恢复");

  const context = await request(
    `/internal/reconcile-context?intentId=${encodeURIComponent(intentId)}`,
    undefined,
    "GET",
  );
  assert(context.status === 200, `DO重启后订单上下文丢失：${JSON.stringify(context)}`);
  assert(context.payload.state === "submitting" &&
    context.payload.clientOrderId === submitting.payload.clientOrderId &&
    context.payload.leaseToken === accountLease.leaseToken,
    "DO重启后订单状态/clientOrderId/账户租约未恢复");

  const schedulerRenew = await request("/internal/scheduler/renew", {
    taskId: schedulerLease.taskId,
    attempt: schedulerLease.attempt,
    leaseToken: schedulerLease.leaseToken,
  });
  assert(schedulerRenew.status === 200, `DO重启后调度租约未恢复：${JSON.stringify(schedulerRenew)}`);

  console.log("[DO SQLite] 持久化恢复通过，开始并发领取竞争测试");
  const raceEnqueue = await request("/internal/scheduler/enqueue", {
    taskId: "health:claim-race",
    taskType: "health_check",
    dueAt: Date.now(),
  });
  assert(raceEnqueue.status === 201, "并发领取测试任务入队失败");
  const [raceA, raceB] = await Promise.all([
    request("/internal/scheduler/claim", { taskType: "health_check", limit: 1 }),
    request("/internal/scheduler/claim", { taskType: "health_check", limit: 1 }),
  ]);
  assert(raceA.status === 200 && raceB.status === 200, "并发claim请求失败");
  const raced = [...(raceA.payload.tasks ?? []), ...(raceB.payload.tasks ?? [])]
    .filter((task) => task.taskId === "health:claim-race");
  assert(raced.length === 1, `并发claim重复领取同一任务：${JSON.stringify(raced)}`);

  console.log("Cloudflare Durable Object SQLite集成测试通过：重启持久化、Alarm、幂等入队、租约恢复、并发claim。");
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  console.error(childLogs);
  process.exitCode = 1;
} finally {
  await stopWorker();
  await rm(persist, { recursive: true, force: true });
}
