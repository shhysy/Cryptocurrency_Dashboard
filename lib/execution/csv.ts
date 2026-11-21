import type { QueuedBuyOrder, TradeLedgerEntry } from "./types";

const columns: (keyof QueuedBuyOrder)[] = [
  "id", "eventKey", "symbol", "quoteAsset", "strategyLabel", "plannedUsdt", "filledUsdt",
  "remainingUsdt", "status", "referencePrice", "createdAt", "updatedAt", "lastError",
];

function csvCell(value: unknown): string {
  let raw = value == null ? "" : String(value);
  // Neutralize spreadsheet formula injection in user-controlled text fields.
  if (/^[=+@\t\r\n-]/.test(raw)) raw = "'" + raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

export function queuedOrdersToCsv(orders: QueuedBuyOrder[]): string {
  return [
    columns.join(","),
    ...orders.map((order) => columns.map((key) => csvCell(order[key])).join(",")),
  ].join("\r\n");
}

/** Browser download helper. IndexedDB remains the source of truth; CSV is an export/backup only. */
export function downloadQueuedOrdersCsv(orders: QueuedBuyOrder[], filename = "待买入订单.csv"): void {
  if (typeof document === "undefined" || typeof URL === "undefined") throw new Error("CSV 下载只能在浏览器中执行");
  const blob = new Blob(["\uFEFF", queuedOrdersToCsv(orders)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}


const tradeLedgerColumns: (keyof TradeLedgerEntry)[] = [
  "fillId", "orderId", "symbol", "side", "time", "price", "qty", "quoteQty",
  "commission", "commissionAsset", "commissionUsdt", "realizedPnlUsdt", "sellKind", "baseRatioAtBuy",
];

/** 只导出Binance已确认的逐笔成交，不包含挂单、限价估算或未成交数量。 */
export function tradeLedgerToCsv(entries: TradeLedgerEntry[]): string {
  return [
    tradeLedgerColumns.join(","),
    ...entries.map((entry) => tradeLedgerColumns.map((key) => csvCell(entry[key])).join(",")),
  ].join("\\r\\n") + "\\r\\n";
}
