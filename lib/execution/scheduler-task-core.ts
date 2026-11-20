export type SchedulerTaskType = "reconcile_intent" | "health_check";
export type SchedulerTaskState = "pending" | "leased" | "completed" | "manual_review";

export interface SchedulerTaskInput {
  taskId: string;
  taskType: SchedulerTaskType;
  dueAt: number;
}

export interface SchedulerTaskLease {
  taskId: string;
  attempt: number;
  leaseToken: string;
  leaseUntil: number;
}

export const SCHEDULER_TASK_MAX_ATTEMPTS = 8;
export const SCHEDULER_TASK_LEASE_MS = 30_000;
export const SCHEDULER_TASK_BASE_BACKOFF_MS = 5_000;
export const SCHEDULER_TASK_MAX_BACKOFF_MS = 15 * 60_000;
export const SCHEDULER_TASK_MAX_FUTURE_MS = 30 * 24 * 60 * 60_000;

/** 只允许无直接下单副作用的任务类型进入基础调度队列。 */
export function validateSchedulerTaskInput(
  input: unknown,
  now: number,
): input is SchedulerTaskInput {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      !Number.isSafeInteger(now) || now <= 0) return false;
  const value = input as Record<string, unknown>;
  if (typeof value.taskId !== "string" ||
      !/^[A-Za-z0-9:_-]{1,160}$/.test(value.taskId)) return false;
  if (value.taskType !== "reconcile_intent" && value.taskType !== "health_check") return false;
  if (!Number.isSafeInteger(value.dueAt) || (value.dueAt as number) <= 0 ||
      (value.dueAt as number) > now + SCHEDULER_TASK_MAX_FUTURE_MS) return false;
  if (value.taskType === "reconcile_intent" &&
      !value.taskId.startsWith("reconcile:")) return false;
  return true;
}

export function schedulerTaskLeaseUntil(now: number): number {
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new Error("调度任务租约时间无效");
  }
  return now + SCHEDULER_TASK_LEASE_MS;
}

/** 领取时递增attempt并生成新token；不能复用旧token。 */
export function createSchedulerTaskLease(
  taskId: string,
  attempt: number,
  now: number,
  leaseToken: string,
): SchedulerTaskLease {
  if (!/^[A-Za-z0-9:_-]{1,160}$/.test(taskId) ||
      !Number.isSafeInteger(attempt) || attempt <= 0 ||
      !Number.isSafeInteger(now) || now <= 0 ||
      typeof leaseToken !== "string" || leaseToken.length < 16 || leaseToken.length > 128) {
    throw new Error("调度任务租约参数无效");
  }
  return { taskId, attempt, leaseToken, leaseUntil: schedulerTaskLeaseUntil(now) };
}

export function assertSchedulerTaskLease(
  current: SchedulerTaskLease | null,
  expected: Pick<SchedulerTaskLease, "taskId" | "attempt" | "leaseToken">,
  now: number,
): void {
  if (!current || current.taskId !== expected.taskId ||
      current.attempt !== expected.attempt ||
      current.leaseToken !== expected.leaseToken ||
      !Number.isSafeInteger(current.attempt) || current.attempt <= 0 ||
      !Number.isSafeInteger(current.leaseUntil) || current.leaseUntil <= now ||
      !Number.isSafeInteger(now) || now <= 0) {
    throw new Error("调度任务租约已过期或fencing token不匹配");
  }
}

/** attempt按1起算；达到上限后返回null，调用方必须转manual_review。 */
export function schedulerTaskRetryDelayMs(attempt: number): number | null {
  if (!Number.isSafeInteger(attempt) || attempt <= 0) return null;
  if (attempt >= SCHEDULER_TASK_MAX_ATTEMPTS) return null;
  const delay = SCHEDULER_TASK_BASE_BACKOFF_MS * 2 ** Math.min(attempt - 1, 20);
  return Math.min(delay, SCHEDULER_TASK_MAX_BACKOFF_MS);
}

export function schedulerTaskRetryAt(attempt: number, now: number): number | null {
  if (!Number.isSafeInteger(now) || now <= 0) return null;
  const delay = schedulerTaskRetryDelayMs(attempt);
  if (delay === null) return null;
  const retryAt = now + delay;
  return Number.isSafeInteger(retryAt) ? retryAt : null;
}

export function expiredSchedulerLeaseDecision(
  attempt: number,
): { state: "pending"; nextAttemptAt: number } | { state: "manual_review" } {
  const nextAttemptAt = schedulerTaskRetryAt(attempt, Date.now());
  return nextAttemptAt === null
    ? { state: "manual_review" }
    : { state: "pending", nextAttemptAt };
}
