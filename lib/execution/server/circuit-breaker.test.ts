import { describe, expect, it } from "vitest";
import { ConsecutiveFailureBreaker } from "./circuit-breaker";

describe("连续失败熔断", () => {
  it("达到阈值返回 true，成功清零", () => {
    const b = new ConsecutiveFailureBreaker(3);
    expect(b.recordFailure()).toBe(false);
    expect(b.recordFailure()).toBe(false);
    expect(b.recordFailure()).toBe(true);
    expect(b.recordFailure()).toBe(false);
    expect(b.count).toBe(4);
    b.recordSuccess();
    expect(b.count).toBe(0);
  });
});
