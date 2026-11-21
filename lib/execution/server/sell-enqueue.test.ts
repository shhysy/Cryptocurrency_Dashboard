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

  it("成交台账读取失败时阻断全部新SELL事件", async () => {
    const store = {
      sellEvents: {
        listSellEvents: vi.fn(async () => []),
        reserveSellEvent: vi.fn(),
      },
      tradeLedger: {
        listTradeLedger: vi.fn(async () => { throw new Error("sqlite read failed"); }),
      },
    } as unknown as LocalExecutionStore;
    const data = {
      source: "binance",
      stale: false,
      market: { accountKnown: true },
      updatedAt: 1_800_000_000_000,
      coins: [{
        symbol: "BTC",
        series: [{ t: 1 }, { t: 2 }],
        signal: { action: { side: "sell", kind: "take_profit", qty: 0.1, label: "止盈1" } },
        buys: [],
        qty: 1,
      }],
    } as unknown as DashboardData;

    await expect(enqueueServerSellSignals(data, store)).rejects.toThrow("已阻断本轮全部SELL入队");
    expect(store.sellEvents.reserveSellEvent).not.toHaveBeenCalled();
  });

});
