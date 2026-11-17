/**
 * 关注币种。后续想加币，往 watchlist 里加一行即可（计价币统一为 quote）。
 * - 现货：symbol 必须是币安现货存在的交易对，例如 DOGE -> DOGEUSDT。
 * - 合约：futures: true，走 U 本位永续公开行情（如 CLUSDT），只出信号，不读现货余额和成交。
 * - Yahoo：yahoo: "CL=F"（备用，Cloudflare 上常被拦，优先用 futures）。
 */
export interface WatchItem {
  symbol: string; // 基础币，如 BTC
  name: string;
  color: string; // Logo / 图表主色
  /** 币安 U 本位永续（公开行情），只出信号 */
  futures?: boolean;
  /** 币安现货没有的品种：填 Yahoo 代码（备用） */
  yahoo?: string;
}

export const quote = "USDT";

/** 只出信号、不读现货余额/成交的品种（合约或 Yahoo） */
export function isSignalOnly(w: WatchItem): boolean {
  return Boolean(w.futures || w.yahoo);
}

export const watchlist: WatchItem[] = [
  { symbol: "BTC", name: "Bitcoin", color: "#f7931a" },
  { symbol: "ETH", name: "Ethereum", color: "#8c9eff" },
  { symbol: "BNB", name: "BNB", color: "#e87ba4" },
  { symbol: "UNI", name: "Uniswap", color: "#c084fc" },
  { symbol: "PAXG", name: "黄金 (PAXG)", color: "#e8b84a" },
  // 币安现货无 CL；U 本位永续 CLUSDT（WTI）自 2026-04 上线，公开行情可拉周线
  { symbol: "CL", name: "原油 (WTI)", color: "#64748b", futures: true },
];
