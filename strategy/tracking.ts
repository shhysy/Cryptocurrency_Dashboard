import type { Candle, Trade } from "./types";

/**
 * 按起算日整理成交：
 * 1. 丢弃起算日之前的成交（含历史上买了又卖掉的）。
 * 2. 对每个币，如果账户持有数量 > 起算日之后买入的数量，说明有「起算日之前就已持有」的部分，
 *    补一条合成买入记录：数量 = 差额，价格 = 起算日当周的周线开盘价（拿不到则用当前价）。
 *    若用户在手动导入里给了该币起算日之前的记录，视为用户明确指定的真实成本，则保留这些记录并不再合成。
 *
 * 返回的 trades 可直接交给 computeCost。
 */
export function applyTrackingStart(opts: {
  trades: Trade[];
  start: number; // ms
  balances: Record<string, number>;
  weekly: Record<string, Candle[]>;
  prices: Record<string, number>;
  symbols: string[];
}): { trades: Trade[]; synthetic: string[] } {
  const { trades, start, balances, weekly, prices, symbols } = opts;
  const out: Trade[] = [];
  const synthetic: string[] = [];

  for (const symbol of symbols) {
    const mine = trades.filter((t) => t.symbol === symbol);
    const manualEarly = mine.filter((t) => t.source === "manual" && t.time < start);
    const after = mine.filter((t) => t.time >= start);
    const kept = [...manualEarly, ...after];
    out.push(...kept);

    const held = balances[symbol] ?? 0;
    const have = kept.reduce((s, t) => s + t.qty, 0);
    const gap = held - have;
    // 数量差额小于持仓的 1% 视为取整误差，不补
    if (manualEarly.length === 0 && gap > held * 0.01 && gap > 0) {
      const wk = weekly[symbol] ?? [];
      const week = [...wk].reverse().find((c) => c.t <= start);
      const price = week?.o ?? prices[symbol];
      if (price > 0) {
        out.push({ id: `opening-${symbol}`, symbol, time: start, price, qty: gap, fee: 0, source: "manual" });
        synthetic.push(symbol);
      }
    }
  }
  return { trades: out.sort((a, b) => a.time - b.time), synthetic };
}
