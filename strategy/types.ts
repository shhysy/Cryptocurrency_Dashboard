/** 策略引擎对外类型（与 UI / API 共享）。 */

export type MarketState = "bull" | "bear" | "transition";
export type VerdictKind = "none" | "accumulate" | "strong" | "sell";
export type CoinTag =
  | "观望"
  | "暂缓"
  | "头仓"
  | "补仓"
  | "备用金"
  | "止盈"
  | "指标止盈"
  | "追踪止损"
  | "底仓减仓";

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export interface Trade {
  id: string;
  symbol: string;
  time: number;
  price: number;
  qty: number;
  fee: number;
  source: "binance" | "manual";
}

export interface Reason {
  key: string;
  text: string;
}

export interface ScoreBreakdown {
  pricePosition: number;
  sentiment: number;
  trend: number;
  rsi: number;
  ma: number;
}

export interface Action {
  kind: string;
  label: string;
  side: "buy" | "sell" | "none";
  plannedUsdt: number | null;
  usdt: number | null;
  qty: number | null;
  sellPct: number | null;
  limits: string[];
  blocked: string[];
  notes: string[];
}

export interface CoinInput {
  symbol: string;
  price: number;
  weekly: Candle[];
  qty: number;
  avgCost: number | null;
  invested: number;
  marketValue: number;
  buys: Trade[];
  signalOnly?: boolean;
}

export interface PortfolioContext {
  fearGreed: number | null;
  btcState: MarketState | null;
  account: {
    known: boolean;
    cashUsdt: number;
    netWorthUsdt: number;
    coreCostUsdt: number;
    altCostUsdt: number;
    altHeldCount: number;
    weeklyBuyUsdt: number;
  };
  now: number;
}

export interface CoinSignal {
  symbol: string;
  group: "core" | "alt";
  kind: VerdictKind;
  tag: CoinTag;
  score: number; // 机会指数 0-scoreMax（默认 100）
  breakdown: ScoreBreakdown;
  reasons: Reason[];
  action: Action;
  metrics: {
    weeklyRsi: number | null;
    ma200: number | null;
    fearGreed: number | null;
    stableCount: number | null;
    stabilized: boolean | null;
    stableItems: boolean[];
    btcState: MarketState | null;
    returnPct: number | null;
  };
}

export interface Verdict {
  kind: VerdictKind;
  primary: CoinSignal | null;
  others: CoinSignal[];
  reasons: Reason[];
}
