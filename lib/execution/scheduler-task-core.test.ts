import { describe, expect, it } from "vitest";
import {
  assertSchedulerTaskLease,
  createSchedulerTaskLease,
  expiredSchedulerLeaseDecision,
  schedulerTaskRetryAt,
  schedulerTaskRetryDelayMs,
  validateSchedulerTaskInput,
  SCHEDULER_TASK_MAX_ATTEMPTS,
  SCHEDULER_TASK_MAX_BACKOFF_MS,
  SCHEDULER_TASK_LEASE_MS,
} from "./scheduler-task-core";

describe("持久化调度任务安全原语", () => {
  const now = 1_800_000_000_000;

  it("只允许白名单任务类型和稳定任务ID", () => {
    expect(validateSchedulerTaskInput({
      taskId: "reconcile:v33:BTC:buy:1",
      taskType: "reconcile_intent",
      dueAt: now,
    }, now)).toBe(true);
    expect(validateSchedulerTaskInput({
      taskId: "health:primary",
      taskType: "health_check",
      dueAt: now + 1000,
    }, now)).toBe(true);
    expect(validateSchedulerTaskInput({
      taskId: "order:1",
      taskType: "place_order",
      dueAt: now,
    }, now)).toBe(false);
  });

  it("拒绝无效时间、超长任务ID和非reconcile前缀", () => {
    expect(validateSchedulerTaskInput({ taskId: "reconcile:x", taskType: "reconcile_intent", dueAt: 0 }, now)).toBe(false);
    expect(validateSchedulerTaskInput({ taskId: "reconcile:x", taskType: "reconcile_intent", dueAt: now + 31 * 24 * 60 * 60_000 }, now)).toBe(false);
    expect(validateSchedulerTaskInput({ taskId: "x", taskType: "reconcile_intent", dueAt: now }, now)).toBe(false);
    expect(validateSchedulerTaskInput({ taskId: "bad id", taskType: "health_check", dueAt: now }, now)).toBe(false);
  });

  it("允许最大长度的reconcile任务ID承载原始intentId", () => {
    const intentId = `v33:${"x".repeat(156)}`;
    const taskId = `reconcile:${intentId}`;
    expect(taskId.length).toBe(170);
    expect(validateSchedulerTaskInput({
      taskId, taskType: "reconcile_intent", dueAt: now,
    }, now)).toBe(true);
    expect(validateSchedulerTaskInput({
      taskId: `${taskId}x`, taskType: "reconcile_intent", dueAt: now,
    }, now)).toBe(false);
  });

  it("创建固定时长的新租约", () => {
    const lease = createSchedulerTaskLease("health:primary", 1, now, "0123456789abcdef");
    expect(lease.leaseUntil).toBe(now + SCHEDULER_TASK_LEASE_MS);
  });

  it("租约校验拒绝过期token和错误attempt", () => {
    const lease = createSchedulerTaskLease("health:primary", 2, now, "0123456789abcdef");
    expect(() => assertSchedulerTaskLease(lease, lease, now + 1)).not.toThrow();
    expect(() => assertSchedulerTaskLease(lease, { ...lease, attempt: 1 }, now + 1)).toThrow();
    expect(() => assertSchedulerTaskLease(lease, { ...lease, leaseToken: "old-token-000000" }, now + 1)).toThrow();
    expect(() => assertSchedulerTaskLease(lease, lease, lease.leaseUntil)).toThrow();
  });

  it("使用有上限的指数退避", () => {
    expect(schedulerTaskRetryDelayMs(1)).toBe(5_000);
    expect(schedulerTaskRetryDelayMs(2)).toBe(10_000);
    expect(schedulerTaskRetryDelayMs(3)).toBe(20_000);
    expect(schedulerTaskRetryDelayMs(8)).toBeNull();
    expect(schedulerTaskRetryDelayMs(0)).toBeNull();
    expect(schedulerTaskRetryDelayMs(4)).toBeLessThanOrEqual(SCHEDULER_TASK_MAX_BACKOFF_MS);
  });

  it("过期任务租约按重试上限决定重新排队或人工复核", () => {
    expect(expiredSchedulerLeaseDecision(1, now)).toEqual({
      state: "pending",
      nextAttemptAt: now + 5_000,
    });
    expect(expiredSchedulerLeaseDecision(SCHEDULER_TASK_MAX_ATTEMPTS, now)).toEqual({
      state: "manual_review",
    });
    expect(expiredSchedulerLeaseDecision(1, 0)).toEqual({ state: "manual_review" });
  });

  it("达到最大重试次数后不再安排自动重试", () => {
    expect(schedulerTaskRetryAt(SCHEDULER_TASK_MAX_ATTEMPTS, now)).toBeNull();
    expect(schedulerTaskRetryAt(3, now)).toBe(now + 20_000);
    expect(schedulerTaskRetryAt(1, 0)).toBeNull();
  });
});
