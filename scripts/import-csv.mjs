// 把 CSV 转成 data/manual-trades.json（买入记录手动导入）。
// 用法: node scripts/import-csv.mjs path/to/trades.csv
// CSV 表头: date,symbol,price,qty[,fee]    例: 2024-03-15,BTC,67000,0.01,0.67
// 重复记录（同币种 + 同一天 + 同价 + 同量）会在读取时与币安接口数据自动去重。
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("用法: node scripts/import-csv.mjs <trades.csv>");
  process.exit(1);
}
const lines = readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const head = lines[0].split(",").map((h) => h.trim().toLowerCase());
for (const k of ["date", "symbol", "price", "qty"]) {
  if (!head.includes(k)) {
    console.error(`缺少列: ${k}（表头需要 date,symbol,price,qty，可选 fee）`);
    process.exit(1);
  }
}
const rows = lines.slice(1).map((line) => {
  const cells = line.split(",").map((c) => c.trim());
  const r = {};
  head.forEach((h, i) => (r[h] = cells[i] ?? ""));
  return { date: r.date, symbol: r.symbol.toUpperCase(), price: Number(r.price), qty: Number(r.qty), ...(r.fee ? { fee: Number(r.fee) } : {}) };
});
const bad = rows.filter((r) => !r.date || !r.symbol || !(r.price > 0) || !(r.qty > 0));
if (bad.length) console.warn(`警告：${bad.length} 行格式不正确，读取时会被忽略`, bad.slice(0, 3));
writeFileSync(new URL("../data/manual-trades.json", import.meta.url), JSON.stringify(rows, null, 2) + "\n");
console.log(`已写入 ${rows.length} 条到 data/manual-trades.json`);
