/**
 * 关注币种。后续想加币，往 watchlist 里加一行即可（计价币统一为 quote）。
 * symbol 必须是币安现货存在的交易对，例如 DOGE -> DOGEUSDT。
 */
export interface WatchItem {
  symbol: string; // 基础币，如 BTC
  name: string;
  color: string; // Logo / 图表主色
}

export const quote = "USDT";

export const watchlist: WatchItem[] = [
  { symbol: "BTC", name: "Bitcoin", color: "#f7931a" },
  { symbol: "ETH", name: "Ethereum", color: "#8c9eff" },
  { symbol: "SOL", name: "Solana", color: "#19e6b0" },
  { symbol: "BNB", name: "BNB", color: "#e87ba4" },
  { symbol: "UNI", name: "Uniswap", color: "#c084fc" },
  { symbol: "LINK", name: "Chainlink", color: "#5b8cff" },
  { symbol: "PAXG", name: "黄金 (PAXG)", color: "#e8b84a" },
];
