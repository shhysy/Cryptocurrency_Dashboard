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

/** BTC 市场状态：收盘 < MA200 且 MA200 下行 = 熊市；收盘 ≥ MA200 且 MA200 不下行 = 牛市；其余 = 过渡。 */
export type MarketState = "bull" | "transition" | "bear";

export type VerdictKind = "none" | "accumulate" | "strong" | "sell";

/** 单个币的标签：买入类（头仓 / 补仓 / 备用金）、卖出类、观望、暂缓（分数够但被风控或冷却挡住）。 */
export type CoinTag = "头仓" | "补仓" | "备用金" | "止盈" | "指标止盈" | "追踪止损" | "底仓减仓" | "暂缓" | "观望";

export interface Reason {
  key: string;
  text: string;
}

export interface CoinInput {
  symbol: string;
  price: number;
  weekly: Candle[]; // 升序，最后一根可为未收盘周线
  qty: number; // 当前持仓数量（已剔除尘埃）
  avgCost: number | null; // 无持仓为 null
  invested: number; // 该币投入本金 USDT
  marketValue: number;
  buys: Trade[]; // 起算日之后的买入（含合成的期初买入），任意顺序
  signalOnly?: boolean; // 币安现货买不到（如原油）：只给信号方向，不给买入金额
}

/** 账户层数据。只用来给「补仓 / 头仓 / 卖出」建议设上限，不影响评分。 */
export interface AccountContext {
  known: boolean; // false = 没读取账户（ENABLE_ACCOUNT 关闭），建议只给方向，不给金额
  cashUsdt: number;
  netWorthUsdt: number; // 现金 + 持仓市值
  coreCostUsdt: number; // 核心资产持仓成本合计
  altCostUsdt: number; // 山寨币持仓成本合计
  altHeldCount: number; // 已持有的山寨币数量
  weeklyBuyUsdt: number; // 近 7 天新增买入
}

export interface PortfolioContext {
  fearGreed: number | null; // 恐惧贪婪指数 0-100，取不到为 null
  btcState: MarketState | null; // 数据不足为 null
  account: AccountContext;
  now: number; // ms，用来算「距上次买入几周」
}

export interface ScoreBreakdown {
  pricePosition: number; // RSI 与 MA200 折减合并，≤ 45
  sentiment: number; // 恐惧贪婪，≤ 30
  trend: number; // 企稳项数 × 5，≤ 15
  rsi: number; // 周线 RSI 单项得分（折减前）
  ma: number; // 周线 MA200 单项得分（折减前）
}

export type ActionKind = "head" | "add" | "reserve" | "takeProfit" | "indicatorProfit" | "trailStop" | "baseReduce" | "none";

export interface Action {
  kind: ActionKind;
  label: string; // 头仓 / 补仓2 / 备用金 / 止盈1 / 指标止盈 / 追踪止损 / 底仓减仓
  side: "buy" | "sell" | "none";
  plannedUsdt: number | null; // 买入：表格里的计划金额（乘以环境系数后）
  usdt: number | null; // 买入：应用所有上限后的建议金额；null = 没读账户
  qty: number | null; // 卖出：建议卖出数量
  sellPct: number | null; // 卖出：占当前持仓的比例 0-1
  limits: string[]; // 哪些上限压低了金额
  blocked: string[]; // 分数够但被挡住的原因（金额为 0 或条件不满足）
  notes: string[]; // 不触发动作的提醒，如浮亏复核
}

export interface CoinSignal {
  symbol: string;
  group: "core" | "alt";
  kind: VerdictKind;
  tag: CoinTag;
  score: number; // 机会指数 0-90
  breakdown: ScoreBreakdown;
  reasons: Reason[];
  action: Action;
  metrics: {
    weeklyRsi: number | null;
    ma200: number | null;
    fearGreed: number | null;
    stableCount: number | null; // 企稳项数 0-3，数据不足为 null
    stabilized: boolean | null; // 是否达到企稳所需项数
    stableItems: boolean[]; // 三个企稳条件各自是否满足
    btcState: MarketState | null;
    returnPct: number | null; // 相对平均成本
  };
}

export interface Verdict {
  kind: VerdictKind;
  primary: CoinSignal | null;
  others: CoinSignal[];
  reasons: Reason[]; // 最多 3 条
}
