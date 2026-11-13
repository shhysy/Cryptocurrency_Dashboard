import { describe, expect, it } from "vitest";
import { buildDashboard } from "./dashboard";
import { buildMock, SCENARIOS, type Scenario } from "./mock";

const run = (sc: Scenario) => buildDashboard(buildMock(sc).raw, { source: "mock", updatedAt: 0, scenario: sc });

describe("示例数据场景", () => {
  it("none：没有任何信号", () => {
    expect(run("none").verdict.kind).toBe("none");
  });
  it("accumulate：BTC 给出买入建议并带金额", () => {
    const v = run("accumulate").verdict;
    expect(v.kind).toBe("accumulate");
    expect(v.primary?.symbol).toBe("BTC");
    expect(v.primary?.action.side).toBe("buy");
    expect(v.primary?.action.usdt).toBeGreaterThan(0);
  });
  it("strong：高分触发强烈买入", () => {
    const v = run("strong").verdict;
    expect(v.kind).toBe("strong");
    expect(v.primary?.score).toBeGreaterThanOrEqual(80);
  });
  it("sell：极度贪婪触发卖出建议", () => {
    const v = run("sell").verdict;
    expect(v.kind).toBe("sell");
    expect(v.primary?.action.side).toBe("sell");
  });
  it("每个币在每个场景下都有分数", () => {
    for (const sc of SCENARIOS) {
      for (const c of run(sc).coins) expect(c.signal.score).toBeGreaterThanOrEqual(0);
    }
  });
});
