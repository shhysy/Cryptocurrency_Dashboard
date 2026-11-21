import { describe, expect, it, vi } from "vitest";
import { enqueueEligibleSellSignals } from "../sell-signal-queue";
import type { DashboardData } from "@/lib/types";

describe("SELL 入队依赖注入", () => {
  it("可注入 list/reserve 而不触达 IndexedDB", async () => {
    const reserve = vi.fn(async (record: { eventKey: string }) => ({
      record: record as never,
      created: true,
    }));
    const data = {
      source: "mock",
      stale: true,
      market: { accountKnown: false },
      coins: [],
    } as unknown as DashboardData;
    const result = await enqueueEligibleSellSignals(data, {
      listSellEvents: async () => [],
      reserveSellEvent: reserve,
      listTradeLedger: async () => [],
    });
    expect(result.created).toBe(0);
    expect(reserve).not.toHaveBeenCalled();
  });
});
