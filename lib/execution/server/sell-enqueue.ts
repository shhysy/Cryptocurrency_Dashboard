import type { DashboardData } from "@/lib/types";
import {
  enqueueEligibleSellSignals,
  type SellEnqueueDeps,
} from "../sell-signal-queue";
import type { LocalExecutionStore } from "./store";

/** 将 LocalExecutionStore 的卖出/台账接口适配为入队依赖。 */
export function sellEnqueueDepsFromStore(store: LocalExecutionStore): SellEnqueueDeps {
  return {
    listSellEvents: () => store.sellEvents.listSellEvents(),
    reserveSellEvent: (record) => store.sellEvents.reserveSellEvent(record),
    listTradeLedger: async () => {
      const rows = await store.tradeLedger.listTradeLedger();
      return rows.map((row) => ({
        symbol: row.symbol,
        fillId: row.fillId,
        qty: row.qty,
        side: row.side,
        sellKind: row.sellKind,
      }));
    },
  };
}

/** 服务端卖出入队节拍（不提交订单）。 */
export async function enqueueServerSellSignals(
  data: DashboardData,
  store: LocalExecutionStore,
): Promise<{ created: number; existing: number; blocked: number }> {
  const result = await enqueueEligibleSellSignals(data, sellEnqueueDepsFromStore(store));
  return {
    created: result.created,
    existing: result.existing,
    blocked: result.blocked.length,
  };
}
