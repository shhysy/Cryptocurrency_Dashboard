/**
 * 关注币种。现货资产通过 buyEnabled 显式控制自动新增买入；合约/Yahoo品种只出信号。
 * - 现货：symbol 必须是币安现货存在的交易对，例如 DOGE -> DOGEUSDT。
 * - 合约：futures: true，走 U 本位永续公开行情，只出信号，不读现货余额和成交。
 * - Yahoo：yahoo: "CL=F"（备用，Cloudflare 上常被拦，优先用 futures）。
 */
export interface WatchItem {
  symbol: string; // 基础币，如 BTC
  name: string;
  color: string; // Logo / 图表主色
  /** 用户明确允许该现货资产参与策略3.3自动新增买入。新增资产必须显式设置。 */
  buyEnabled?: boolean;
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
  { symbol: "BTC", name: "Bitcoin", color: "#f7931a", buyEnabled: true },
  { symbol: "ETH", name: "Ethereum", color: "#8c9eff", buyEnabled: true },
  { symbol: "BNB", name: "BNB", color: "#e87ba4", buyEnabled: true },
  { symbol: "UNI", name: "Uniswap", color: "#c084fc", buyEnabled: true },
  { symbol: "PAXG", name: "黄金 (PAXG)", color: "#e8b84a", buyEnabled: true },
  // 币安现货无 CL；U 本位永续 CLUSDT（WTI）仅提供公开行情，只出信号
  { symbol: "CL", name: "原油 (WTI)", color: "#64748b", futures: true },
];

/**
 * 策略3.3新增买入许可：仅接受 watchlist 中显式 buyEnabled=true 的现货资产。
 * BTC、ETH、BNB、UNI、PAXG 均按用户最新确认允许新增买入。
 * 未列入资产池或 signal-only 品种一律拒绝；该规则不影响卖出。
 */
export function isBuyAssetEligible(symbol: string): boolean {
  const item = watchlist.find((entry) => entry.symbol === symbol);
  return Boolean(item && item.buyEnabled === true && !isSignalOnly(item));
}
