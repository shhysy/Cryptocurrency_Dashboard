import type { CoinSignal, Verdict } from "@/strategy/types";

export type Position = "low" | "mid" | "high";

export interface TradeRow {
  id: string;
  symbol: string;
  time: number;
  price: number;
  qty: number;
  amount: number; // USDT
  pnlPct: number; // 相对当前价
  pnlUsdt: number;
  position: Position; // 买入时处于近 52 周价格区间的位置
  positionPct: number; // 0-1，0 = 52 周最低
  source: "binance" | "manual";
}

export interface CoinCard {
  symbol: string;
  name: string;
  color: string;
  price: number;
  change24h: number; // 小数
  qty: number;
  marketValue: number;
  avgCost: number | null;
  invested: number;
  returnPct: number | null;
  toDoublePct: number | null; // 距翻倍还差多少（百分点），已翻倍为 0
  doubleProgress: number; // 0-1
  series: { t: number; c: number }[]; // 周线收盘
  buys: { id: string; t: number; price: number; qty: number; position: Position }[];
  signal: CoinSignal;
}

export interface DashboardData {
  source: "mock" | "binance";
  scenario?: string;
  updatedAt: number;
  stale: boolean;
  staleReasons: string[];
  notes: string[]; // 数据口径提示，如持仓数量与成交记录不一致
  account: { assets: { asset: string; qty: number; usdt: number | null }[]; cashUsdt: number };
  summary: {
    totalAssets: number; // 持仓市值 + 现金（稳定币）
    totalValue: number;
    totalInvested: number;
    pnl: number;
    pnlPct: number;
    investedCny: number;
    capitalLimitCny: number;
    usdtCny: number;
  };
  equityCurve: { t: number; value: number; invested: number }[];
  allocation: { symbol: string; color: string; value: number; weight: number }[];
  coins: CoinCard[];
  trades: TradeRow[];
  verdict: Verdict;
  config: {
    doubleLine: number;
  };
}
