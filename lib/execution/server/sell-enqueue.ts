import type { DashboardData } from "@/lib/types";
import {
  buildSellEventReservations,
  type BaseReduceLedgerFill,
} from "../sell-signal-queue";
import type { LocalExecutionStore } from "./store";

/**
 * 服务端卖出入队：使用 SQLite sellEvents / tradeLedger，不碰 IndexedDB。
 * 复用 buildSellEventReservations 纯函数，保证与浏览器状态机一致。
 */
export async function enqueueServerSellSignals(
  data: DashboardData,
  store: LocalExecutionStore,
): Promise<{ created: number; existing: number; blocked: number }> {
  const existingEvents = await store.sellEvents.listSellEvents();
  let ledgerFills: BaseReduceLedgerFill[] | undefined;
  try {
    const ledger = await store.tradeLedger.listTradeLedger();
    ledgerFills = ledger.map((row) => ({
      symbol: row.symbol,
      fillId: row.fillId,
      qty: row.qty,
      side: row.side,
      sellKind: row.sellKind,
    }));
  } catch (error) {
    // 台账不可读时不能安全计算已卖数量/底仓边界；禁止创建任何新SELL事件。
    throw new Error(`卖出成交台账读取失败，已阻断本轮全部SELL入队：${error instanceof Error ? error.message : "未知错误"}`);
  }

  const plan = buildSellEventReservations(data, existingEvents, { ledgerFills });
  let created = 0;
  let existing = 0;
  for (const record of plan.records) {
    const result = await store.sellEvents.reserveSellEvent(record);
    if (result.created) created += 1;
    else existing += 1;
  }
  return { created, existing, blocked: plan.blocked.length };
}
