import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { TradeLedgerEntry } from "../types";
import type { LocalExecutionStore } from "./store";

const COLUMNS: Array<keyof TradeLedgerEntry> = [
  "fillId", "orderId", "symbol", "side", "time", "price", "qty", "quoteQty",
  "commission", "commissionAsset", "commissionUsdt", "realizedPnlUsdt", "sellKind", "baseRatioAtBuy",
];

function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+@\\t\\r\\n-]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** 导出SQLite已确认成交台账；只包含Binance真实fill，不包含挂单限价或未成交订单。 */
export function tradeLedgerToCsv(entries: TradeLedgerEntry[]): string {
  const header = COLUMNS.join(",");
  const rows = entries.map((entry) => COLUMNS.map((column) => csvCell(entry[column])).join(","));
  return [header, ...rows].join("\\r\\n") + "\\r\\n";
}

/**
 * 原子重建真实成交CSV。SQLite是唯一事实来源；临时文件写完后rename，
 * 崩溃时下次Trader循环会从SQLite重新生成，避免DB/CSV双写不一致。
 */
export async function syncTradeLedgerCsv(
  store: LocalExecutionStore,
  filePath = "data/trades.csv",
): Promise<{ rows: number; path: string }> {
  const target = resolve(filePath);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const entries = await store.tradeLedger.listTradeLedger();
  const temporary = `${target}.tmp`;
  await writeFile(temporary, "\\uFEFF" + tradeLedgerToCsv(entries), { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, target);
  await chmod(target, 0o600);
  return { rows: entries.length, path: target };
}
