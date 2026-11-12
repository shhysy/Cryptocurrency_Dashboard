import type { Trade } from "@/strategy/types";
import { watchlist } from "@/watchlist.config";

/**
 * 手动导入记录。字段：date(日期) / symbol(币种) / price(价格，USDT) / qty(数量) / fee(可选，USDT)。
 * 支持 JSON 数组或 CSV 文本（带表头：date,symbol,price,qty[,fee]）。
 * 日期只写到天时，按当天 UTC 12:00 处理。
 */
export interface ManualRow {
  date: string;
  symbol: string;
  price: number | string;
  qty: number | string;
  fee?: number | string;
}

export function parseCsv(text: string): ManualRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const head = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    const row: Record<string, string> = {};
    head.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row as unknown as ManualRow;
  });
}

export function normalizeManual(rows: ManualRow[]): { trades: Trade[]; skipped: number } {
  const known = new Set(watchlist.map((w) => w.symbol));
  const trades: Trade[] = [];
  let skipped = 0;
  rows.forEach((r, i) => {
    const symbol = String(r.symbol ?? "").toUpperCase().replace(/USDT$/, "");
    const price = Number(r.price);
    const qty = Number(r.qty);
    const fee = r.fee === undefined || r.fee === "" ? 0 : Number(r.fee);
    const raw = String(r.date ?? "");
    const time = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? Date.parse(`${raw}T12:00:00Z`) : Date.parse(raw);
    if (!known.has(symbol) || !(price > 0) || !(qty > 0) || !Number.isFinite(time) || !Number.isFinite(fee)) {
      skipped++;
      return;
    }
    trades.push({ id: `manual-${symbol}-${time}-${i}`, symbol, time, price, qty, fee, source: "manual" });
  });
  return { trades, skipped };
}
