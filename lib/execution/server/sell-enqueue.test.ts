import { describe, expect, it, vi } from "vitest";
import { enqueueServerSellSignals } from "./sell-enqueue";
import type { LocalExecutionStore } from "./store";
import type { DashboardData } from "@/lib/types";

describe("服务端 SELL 入队", () => {
  it("stale 数据不创建事件", async () => {
    const store = {
      sellEvents: {
        listSellEvents: vi.fn(async () => []),
        reserveSellEvent: vi.fn(),
      },
      tradeLedger: {
        listTradeLedger: vi.fn(async () => []),
      },
    } as unknown as LocalExecutionStore;
    const data = {
      source: "mock",
      stale: true,
      market: { accountKnown: false },
      coins: [],
    } as unknown as DashboardData;
    const result = await enqueueServerSellSignals(data, store);
    expect(result.created).toBe(0);
    expect(store.sellEvents.reserveSellEvent).not.toHaveBeenCalled();
  });
});
