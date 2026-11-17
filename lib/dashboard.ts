import { strategyConfig } from "@/strategy.config";
import { isSignalOnly, quote, watchlist } from "@/watchlist.config";
import { computeCost } from "@/strategy/cost";
import { btcMarketState, buildVerdict, evaluateCoin, isCore } from "@/strategy/engine";
import type { Candle, Trade } from "@/strategy/types";
import type { CoinCard, DashboardData, Position, TradeRow } from "./types";

/** 成本价是否含手续费（见 strategy/cost.ts 的规则说明） */
export const INCLUDE_FEE = true;
export const STABLES = ["USDT", "USDC", "FDUSD", "BUSD"];

export interface RawData {
  tickers: Record<string, { price: number; change24h: number }>; // key = 基础币
  weekly: Record<string, Candle[]>;
  fearGreed?: number | null; // 恐惧贪婪指数，取不到为 null
  accountKnown?: boolean; // 是否读取了账户余额与成交（决定能否给出买入金额建议）
  trades: Trade[];
  balances?: Record<string, number>; // 真实持仓数量；没有则按成交累计
  extraAssets?: { asset: string; qty: number; usdt: number | null }[]; // 账户内全部非零资产
}
