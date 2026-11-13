/**
 * 关注币种。后续想加币，往 watchlist 里加一行即可（计价币统一为 quote）。
 * symbol 必须是币安现货存在的交易对，例如 DOGE -> DOGEUSDT。
 */
export interface WatchItem {
  symbol: string; // 基础币，如 BTC
  name: string;
  color: string; // Logo / 图表主色
  // 币安现货没有的品种（如原油）：填 Yahoo 代码，行情和周线走 Yahoo，只出信号，不读余额和成交
  yahoo?: string;
}

export const quote = "USDT";

export const watchlist: WatchItem[] = [
  { symbol: "BTC", name: "Bitcoin", color: "#f7931a" },
  { symbol: "ETH", name: "Ethereum", color: "#8c9eff" },
  { symbol: "BNB", name: "BNB", color: "#e87ba4" },
  { symbol: "UNI", name: "Uniswap", color: "#c084fc" },
  { symbol: "PAXG", name: "黄金 (PAXG)", color: "#e8b84a" },
  { symbol: "CL", name: "原油 (WTI)", color: "#64748b", yahoo: "CL=F" },
];
