import type { Trade } from "./types";

/**
 * 成本价计算规则（加权平均，仅统计买入）：
 *   平均成本 = Σ(价格 × 数量 + 手续费) ÷ Σ 数量
 * - includeFee = true（默认）时手续费计入成本；false 时只算 Σ(价格 × 数量) ÷ Σ 数量。
 * - 手续费以 USDT 计。手续费若是买到的币本身，接口层按成交价折算；
 *   若是 BNB 等第三方币，接口层无法可靠折算，按 0 处理（影响通常 < 0.1%）。
 * - 本看板只记录买入，不处理卖出对成本的影响。
 */
export function computeCost(trades: Trade[], includeFee = true) {
  let qty = 0;
  let spent = 0;
  for (const t of trades) {
    qty += t.qty;
    spent += t.price * t.qty + (includeFee ? t.fee : 0);
  }
  return { qty, invested: spent, avgCost: qty > 0 ? spent / qty : null };
}

/**
 * 合并币安接口成交与手动导入记录并去重。
 * 去重键：币种 + 日期(UTC 天) + 价格(6 位) + 数量(6 位)。
 * 手动记录常常只有日期没有时分秒，所以只比较到天；同一天同价同量视为同一笔，保留币安数据。
 */
export function mergeTrades(apiTrades: Trade[], manualTrades: Trade[]): Trade[] {
  const key = (t: Trade) =>
    `${t.symbol}|${new Date(t.time).toISOString().slice(0, 10)}|${t.price.toFixed(6)}|${t.qty.toFixed(6)}`;
  const seen = new Set<string>();
  const out: Trade[] = [];
  for (const t of [...apiTrades, ...manualTrades]) {
    const k = key(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.sort((a, b) => a.time - b.time);
}
