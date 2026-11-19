import type { QueueStatus } from "./types";

/** A reconciliation worker may mutate an order only while its attempt is current and locked. */
export function isCurrentBuyAttempt(
  order: { attemptCount: number; status: QueueStatus } | null | undefined,
  attempt: number,
): boolean {
  return Boolean(order && Number.isInteger(attempt) && attempt >= 0 &&
    order.attemptCount === attempt + 1 && order.status === "reconcile_required");
}
