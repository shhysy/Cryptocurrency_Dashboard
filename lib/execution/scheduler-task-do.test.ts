import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionAccountDO } from "./execution-account-do";

type Row = Record<string, unknown>;

class SchedulerSqlFake {
  readonly statements: string[] = [];
  readonly tasks = new Map<string, Row>();

  exec(query: string, ...bindings: unknown[]) {
    this.statements.push(query);
    let rows: Row[] = [];

    if (query.includes("INSERT INTO scheduler_tasks")) {
      const [taskId, taskType, dueAt, createdAt, updatedAt] = bindings as [string, string, number, number, number];
      if (!this.tasks.has(taskId)) {
        this.tasks.set(taskId, {
          task_id: taskId, task_type: taskType, due_at: dueAt, state: "pending",
          attempt: 0, lease_token: null, lease_until: null, next_attempt_at: 0,
          last_error: null, created_at: createdAt, updated_at: updatedAt,
        });
        rows = [{ task_id: taskId }];
      }
    } else if (query.includes("SELECT task_id, task_type, due_at, state, attempt FROM scheduler_tasks")) {
      const row = this.tasks.get(String(bindings[0]));
      rows = row ? [{ ...row }] : [];
    } else if (query.includes("SELECT task_id, task_type, due_at, attempt") && query.includes("state = 'pending'")) {
      const [now, retryAt, taskType, , limit] = bindings as [number, number, string | null, string | null, number];
      rows = [...this.tasks.values()]
        .filter((row) => row.state === "pending" && Number(row.due_at) <= now &&
          Number(row.next_attempt_at) <= retryAt && (!taskType || row.task_type === taskType))
        .sort((a, b) => Number(a.due_at) - Number(b.due_at))
        .slice(0, limit)
        .map((row) => ({ ...row }));
    } else if (query.includes("SELECT state, attempt, lease_token, lease_until FROM scheduler_tasks")) {
      const row = this.tasks.get(String(bindings[0]));
      rows = row ? [{ ...row }] : [];
    } else if (query.includes("UPDATE scheduler_tasks") && query.includes("SET state = 'leased'")) {
      const [attempt, leaseToken, leaseUntil, updatedAt, taskId, oldAttempt] = bindings as
        [number, string, number, number, string, number, number, number];
      const row = this.tasks.get(taskId);
      if (row && row.state === "pending" && row.attempt === oldAttempt) {
        Object.assign(row, {
          state: "leased", attempt, lease_token: leaseToken, lease_until: leaseUntil, updated_at: updatedAt,
        });
        rows = [{ task_id: taskId }];
      }
    } else if (query.includes("UPDATE scheduler_tasks") && query.includes("SET state = 'completed'")) {
      const [updatedAt, taskId, attempt, leaseToken, now] = bindings as
        [number, string, number, string, number];
      const row = this.tasks.get(taskId);
      if (row && row.state === "leased" && row.attempt === attempt &&
          row.lease_token === leaseToken && Number(row.lease_until) > now) {
        Object.assign(row, { state: "completed", lease_until: null, next_attempt_at: 0, last_error: null, updated_at: updatedAt });
        rows = [{ task_id: taskId }];
      }
    } else if (query.includes("UPDATE scheduler_tasks") && query.includes("SET state = 'pending'")) {
      const [nextAttemptAt, reason, updatedAt, taskId, attempt, leaseToken, now] = bindings as
        [number, string, number, string, number, string, number];
      const row = this.tasks.get(taskId);
      if (row && row.state === "leased" && row.attempt === attempt &&
          row.lease_token === leaseToken && Number(row.lease_until) > now) {
        Object.assign(row, {
          state: "pending", lease_token: null, lease_until: null,
          next_attempt_at: nextAttemptAt, last_error: reason, updated_at: updatedAt,
        });
        rows = [{ task_id: taskId }];
      }
    } else if (query.includes("UPDATE scheduler_tasks") && query.includes("SET state = 'manual_review'")) {
      const [reason, updatedAt, taskId, attempt, leaseToken, now] = bindings as
        [string, number, string, number, string, number];
      const row = this.tasks.get(taskId);
      if (row && row.state === "leased" && row.attempt === attempt &&
          row.lease_token === leaseToken && Number(row.lease_until) > now) {
        Object.assign(row, {
          state: "manual_review", lease_token: null, lease_until: null,
          last_error: reason, updated_at: updatedAt,
        });
        rows = [{ task_id: taskId }];
      }
    } else if (query.includes("SELECT task_id, attempt FROM scheduler_tasks") && query.includes("lease_until <= ?")) {
      const now = Number(bindings[0]);
      rows = [...this.tasks.values()]
        .filter((row) => row.state === "leased" && row.lease_until !== null && Number(row.lease_until) <= now)
        .map((row) => ({ task_id: row.task_id, attempt: row.attempt }));
    } else if (query.includes("SELECT task_id, attempt FROM scheduler_tasks") && query.includes("task_type = 'health_check'")) {
      const [now, retryAt] = bindings as [number, number];
      rows = [...this.tasks.values()]
        .filter((row) => row.task_type === "health_check" && row.state === "pending" &&
          Number(row.due_at) <= now && Number(row.next_attempt_at) <= retryAt)
        .map((row) => ({ task_id: row.task_id, attempt: row.attempt }));
    } else if (query.includes("SELECT COUNT(*) AS total FROM order_intents")) {
      rows = [{ total: 0 }];
    } else if (query.includes("SELECT MIN(CASE")) {
      const due = [...this.tasks.values()]
        .filter((row) => row.state === "leased" ||
          (row.state === "pending" && row.task_type === "health_check"))
        .map((row) => row.state === "leased" ? Number(row.lease_until) :
          Math.max(Number(row.due_at), Number(row.next_attempt_at)));
      rows = [{ next_at: due.length ? Math.min(...due) : null }];
    }
    return { toArray: () => rows };
  }
}

function makeCoordinator() {
  const sql = new SchedulerSqlFake();
  let alarm: number | null = null;
  const state = {
    storage: {
      sql,
      getAlarm: async () => alarm,
      setAlarm: async (value: number) => { alarm = value; },
      deleteAlarm: async () => { alarm = null; },
      transactionSync: <T>(callback: () => T): T => callback(),
    },
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>): Promise<T> => callback(),
  };
  return { coordinator: new ExecutionAccountDO(state, {}), sql, getAlarm: () => alarm };
}

function post(path: string, body: unknown): Request {
  return new Request(`https://execution.internal${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("DO持久化调度任务队列", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-21T04:00:00.000Z"));
  });

  it("重复enqueue幂等，taskId内容冲突时拒绝覆盖", async () => {
    const { coordinator, sql } = makeCoordinator();
    const task = { taskId: "health:daily:1", taskType: "health_check", dueAt: Date.now() };
    const first = await coordinator.fetch(post("/internal/scheduler/enqueue", task));
    const second = await coordinator.fetch(post("/internal/scheduler/enqueue", task));
    const conflict = await coordinator.fetch(post("/internal/scheduler/enqueue", { ...task, dueAt: task.dueAt + 1 }));

    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ accepted: true, created: true });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ accepted: true, created: false });
    expect(conflict.status).toBe(409);
    expect(sql.tasks.size).toBe(1);
  });

  it("claim生成新的attempt和token；旧token不能ack，正确ack可幂等重放", async () => {
    const { coordinator } = makeCoordinator();
    await coordinator.fetch(post("/internal/scheduler/enqueue", {
      taskId: "health:claim:1", taskType: "health_check", dueAt: Date.now(),
    }));
    const claimResponse = await coordinator.fetch(post("/internal/scheduler/claim", { limit: 1, taskType: "health_check" }));
    const claimBody = await claimResponse.json() as { tasks: Array<{ taskId: string; attempt: number; leaseToken: string }> };
    const lease = claimBody.tasks[0];
    expect(lease).toBeDefined();
    expect(lease.attempt).toBe(1);
    expect(lease.leaseToken.length).toBeGreaterThanOrEqual(16);

    const stale = await coordinator.fetch(post("/internal/scheduler/ack", {
      taskId: lease.taskId, attempt: lease.attempt, leaseToken: "stale-token-value",
    }));
    expect(stale.status).toBe(409);

    const ack = await coordinator.fetch(post("/internal/scheduler/ack", lease));
    const replay = await coordinator.fetch(post("/internal/scheduler/ack", lease));
    expect(ack.status).toBe(200);
    expect(await replay.json()).toMatchObject({ ok: true, completed: true, idempotent: true });
  });

  it("retry使用指数退避并清除旧租约", async () => {
    const { coordinator, sql } = makeCoordinator();
    await coordinator.fetch(post("/internal/scheduler/enqueue", {
      taskId: "reconcile:intent-1", taskType: "reconcile_intent", dueAt: Date.now(),
    }));
    const claim = await coordinator.fetch(post("/internal/scheduler/claim", { taskType: "reconcile_intent" }));
    const body = await claim.json() as { tasks: Array<{ taskId: string; attempt: number; leaseToken: string }> };
    const lease = body.tasks[0];
    const retry = await coordinator.fetch(post("/internal/scheduler/retry", {
      ...lease, reason: "只读对账执行器尚未接通",
    }));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ ok: true, state: "pending", nextAttemptAt: Date.now() + 5_000 });
    expect(sql.tasks.get(lease.taskId)).toMatchObject({
      state: "pending", lease_token: null, lease_until: null, attempt: 1,
    });
  });

  it("Alarm只自动完成无外部副作用的health_check，不擅自完成reconcile_intent", async () => {
    const { coordinator, sql } = makeCoordinator();
    await coordinator.fetch(post("/internal/scheduler/enqueue", {
      taskId: "health:alarm:1", taskType: "health_check", dueAt: Date.now(),
    }));
    await coordinator.fetch(post("/internal/scheduler/enqueue", {
      taskId: "reconcile:alarm:1", taskType: "reconcile_intent", dueAt: Date.now(),
    }));
    await coordinator.alarm();
    expect(sql.tasks.get("health:alarm:1")?.state).toBe("completed");
    expect(sql.tasks.get("reconcile:alarm:1")?.state).toBe("pending");
  });
});
