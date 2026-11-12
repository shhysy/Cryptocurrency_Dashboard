export interface Candle {
  t: number; // 开盘时间 ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Trade {
  id: string;
  symbol: string; // 基础币，如 BTC
  time: number; // ms
  price: number; // USDT
  qty: number;
  fee: number; // 已折算为 USDT 的手续费，未知则为 0
  source: "binance" | "manual";
}

export type CoinTag = "加仓区" | "观望" | "过热" | "可卖出";
export type VerdictKind = "none" | "accumulate" | "strong" | "risk" | "sell";

export interface Reason {
  key: string;
  text: string;
}

export interface CoinInput {
  symbol: string;
  price: number;
  weekly: Candle[]; // 升序，最后一根可为未收盘周线
  monthly: Candle[];
  qty: number;
  avgCost: number | null; // 无持仓为 null
  invested: number; // 该币投入本金 USDT
  marketValue: number;
}

export interface PortfolioContext {
  totalInvestedUsdt: number;
  totalValueUsdt: number;
}

export interface CoinSignal {
  symbol: string;
  kind: VerdictKind;
  tag: CoinTag;
  score: number; // 机会指数 0-100
  reasons: Reason[]; // 触发依据
  addPct: number | null; // 建议动用「剩余额度」的百分比
  addAmountCny: number | null;
  sellMin: number | null; // 建议卖出比例 0-1
  sellMax: number | null;
  metrics: {
    weeklyRsi: number | null;
    monthlyRsi: number | null;
    drawdown: number | null; // 距 52 周高点回撤，0.35 = 35%
    ma200: number | null;
    ma200Source: "weekly" | "monthly" | null;
    ma50Deviation: number | null;
    returnPct: number | null; // 相对平均成本
    weight: number; // 仓位占比
  };
}

export interface Verdict {
  kind: VerdictKind;
  primary: CoinSignal | null;
  others: CoinSignal[];
  reasons: Reason[]; // 最多 3 条
}
