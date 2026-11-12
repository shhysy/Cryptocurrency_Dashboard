/**
 * 策略阈值（周线 / 月线级别）。所有数字都在这里改，策略引擎不含硬编码阈值。
 * 百分比一律用小数：0.3 = 30%。
 */
export const strategyConfig = {
  // false = 信号只看价格、周线 RSI、MA，不看你的成本价（默认）。
  // true  = 额外启用：低于成本 15% 提示摊低、收益 +100%/+200%/+300% 提示止盈。
  useCostSignals: false,
  // 折合不足这个金额（USDT）的余额不计入持仓和总资产
  minAssetUsdt: 0.5,

  rsi: {
    period: 14,
    weeklyBuy: 35, // 周线 RSI < 35：偏低，提示加仓
    weeklyStrongBuy: 30, // < 30：强烈买入
    weeklyOverheated: 70, // > 70：过热，暂停加仓
    weeklySell: 80, // > 80 且收益为正：分批减仓
    monthlyLow: 40, // 月线 RSI <= 40：历史低位区
  },
  drawdown: {
    lookbackWeeks: 52,
    // 距 52 周高点回撤档位 -> 建议动用「剩余额度」的百分比
    tiers: [
      { dd: 0.3, addPct: 10, label: "小额" },
      { dd: 0.4, addPct: 20, label: "中额" },
      { dd: 0.5, addPct: 30, label: "大额" },
    ],
  },
  ma: {
    weeklyPeriod: 200, // 周线 MA200（约 4 年线）
    monthlyFallbackPeriod: 20, // 周线数据不足 200 根时，用月线 MA20 近似
    nearPct: 0.05, // 价格 <= MA × (1 + 5%) 视为接近/跌破
    deviationPeriod: 50, // 周线 MA50
    overheatDeviation: 0.5, // 价格高于 MA50 50% 以上：过热
  },
  cost: {
    belowCostPct: -0.15, // 低于平均成本 15%：可摊低成本
    addPct: 5,
  },
  risk: {
    maxCoinWeight: 0.4, // 单币仓位占比上限（超过则暂停加仓、提示再平衡）
    maxTotalCapitalCny: 50000, // 持仓总市值上限（人民币）。加仓由你自己操作，所以按当前市值比较，不看累计投入
    usdtCny: 7.1, // USDT -> CNY 折算汇率，仅用于上限判断，请按需修改
  },
  sell: {
    // 收益率达到 ret（1 = +100% 翻倍）时，建议卖出 min ~ max 比例
    levels: [
      { ret: 1, min: 0.33, max: 0.5 },
      { ret: 2, min: 0.2, max: 0.3 },
      { ret: 3, min: 0.2, max: 0.3 },
    ],
    rsiHot: { min: 0.1, max: 0.2 }, // 周线 RSI > weeklySell 且收益为正
  },
  score: {
    // 机会指数（0-100）各项得分
    rsiBuy: 25,
    rsiStrong: 35,
    drawdownByTier: [10, 20, 25],
    maNear: 15,
    monthlyRsiLow: 10,
    belowCost: 10,
    overheatPenalty: 30,
  },
  thresholds: {
    accumulateScore: 25, // 机会指数 >= 25：适合加仓
    strongScore: 60, // >= 60：强烈买入
  },
};

export type StrategyConfig = typeof strategyConfig;
