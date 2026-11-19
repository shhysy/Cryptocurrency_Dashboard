import { describe, expect, it } from "vitest";
import { isCurrentBuyAttempt } from "./buy-attempt";

describe("current buy attempt guard", () => {
  it("accepts only the latest attempt while the queue is locked for reconciliation", () => {
    expect(isCurrentBuyAttempt({ attemptCount: 1, status: "reconcile_required" }, 0)).toBe(true);
    expect(isCurrentBuyAttempt({ attemptCount: 2, status: "reconcile_required" }, 0)).toBe(false);
    expect(isCurrentBuyAttempt({ attemptCount: 1, status: "pending" }, 0)).toBe(false);
    expect(isCurrentBuyAttempt({ attemptCount: 0, status: "reconcile_required" }, 0)).toBe(false);
  });
});
