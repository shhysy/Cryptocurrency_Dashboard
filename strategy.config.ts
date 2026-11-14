/**
 * 策略阈值（周线级别），对应《长期投资策略 V3.3》表格的「参数中心」。
 * 所有数字都在这里改，策略引擎不含硬编码阈值。百分比一律用小数：0.3 = 30%；金额单位 USDT。
 */

/** 一套参数形态：核心资产用积极型，其余币种用保守型。 */
export interface Profile {
  label: string;
  capUsdt: number; // 单币成本上限（头仓 + 补仓 + 备用金）
  headHigh: number; // 头仓金额：高分档
  headNormal: number; // 头仓金额：常规档
  minScore: number; // 买入最低分数
  highScore: number; // 高分头仓门槛（且 BTC 非熊市）
  stabilizeMin: number; // 企稳 3 项里至少满足几项
  cooldownWeeks: number; // 两次买入的最小间隔（周）
  cooldownBearWeeks: number; // BTC 熊市时的最小间隔（周）
  transitionFactor: number; // BTC 过渡市金额系数
  bearFactor: number; // BTC 熊市金额系数
  bearBlocks: boolean; // BTC 熊市是否禁止新增
  baseRatio: number; // 长期底仓比例（按累计买入数量锁定）
  adds: { drop: number; usdt: number }[]; // 补仓档位：较头仓价下跌 drop 时补 usdt
  reserve: { usdt: number; drop: number }; // 特殊行情备用金
  takeProfit: { mult: number; ratio: number }[]; // 价格 ≥ 均价 × mult 时卖出周期仓的 ratio
  trailStart: number; // 价格曾达到均价 × 该倍数后启用追踪止损
  trailDrawdown: number; // 追踪止损：自峰值回撤比例
}

export const strategyConfig = {
  // 折合不足这个金额（USDT）的余额不计入持仓和总资产
  minAssetUsdt: 0.5,

  // 这些币归「核心」（积极型），其余都按「山寨」（保守型）
  coreSymbols: ["BTC", "PAXG"],

  rsi: {
    period: 14,
    // 周线 RSI ≤ max 得 points 分，从严到宽匹配，命中第一档即停
    tiers: [
      { max: 30, points: 30 },
      { max: 35, points: 22 },
      { max: 40, points: 12 },
    ],
    overheat: 75, // 周线 RSI > 75：过热，进入止盈检查
    stabilizeBelow: 45, // 企稳条件 2：RSI 低于此值且较上周回升
  },
  ma: {
    weeklyPeriod: 200, // 周线 MA200（约 4 年线）
    directionWeeks: 4, // BTC 判断 MA200 方向：与 4 周前比
    // 价格 / MA200 ≤ max 得 points 分；从严到宽匹配，命中第一档即停。
    // V3.3 细化：原来两档粗粒度（≤1.00/≤1.05），现分六档拉开梯度，越低于 MA200 分数越高。
    tiers: [
      { max: 0.7, points: 30 },
      { max: 0.8, points: 24 },
      { max: 0.9, points: 18 },
      { max: 1.0, points: 12 },
      { max: 1.05, points: 6 },
    ],
  },
  fearGreed: {
    // 恐惧贪婪指数 ≤ max 得 points 分；从严到宽匹配，命中第一档即停。
    // V3.3 细化：原来两档粗粒度（≤25/≤40），现分六档拉开梯度，低贪婪高分更鼓励抄底。
    tiers: [
      { max: 10, points: 30 },
      { max: 15, points: 25 },
      { max: 25, points: 20 },
      { max: 35, points: 10 },
      { max: 40, points: 5 },
    ],
    extremeFear: 25, // 备用金的「极度恐惧」门槛（与打分最严档解耦，保持 V3.2 的触发条件不过松）
    overheat: 80, // ≥ 80：过热，进入止盈检查
  },
  score: {
    pricePositionCap: 45, // 价格位置得分上限
    // 价格位置 = RSI 与 MA200 两项里较高者 + 较低者 × 折减系数（两者高度相关，避免重复计分）
    pricePositionDiscount: 0.5,
    trendPerItem: 5, // 企稳每满足一项得分（最高 15）
  },
  scoreMax: 90,

  profiles: {
    core: {
      label: "积极型",
      capUsdt: 1000,
      headHigh: 200,
      headNormal: 150,
      minScore: 55,
      highScore: 80,
      stabilizeMin: 2,
      cooldownWeeks: 2,
      cooldownBearWeeks: 4,
      transitionFactor: 0.85,
      bearFactor: 0.7,
      bearBlocks: false,
      baseRatio: 0.4,
      adds: [
        { drop: 0.15, usdt: 150 },
        { drop: 0.3, usdt: 150 },
        { drop: 0.45, usdt: 150 },
        { drop: 0.6, usdt: 150 },
      ],
      reserve: { usdt: 200, drop: 0.6 },
      takeProfit: [
        { mult: 2, ratio: 0.15 },
        { mult: 3, ratio: 0.2 },
        { mult: 5, ratio: 0.2 },
      ],
      trailStart: 1.3,
      trailDrawdown: 0.3,
    },
    alt: {
      label: "保守型",
      capUsdt: 500,
      headHigh: 100,
      headNormal: 75,
      minScore: 75,
      highScore: 90,
      stabilizeMin: 3,
      cooldownWeeks: 4,
      cooldownBearWeeks: 4,
      transitionFactor: 0.5,
      bearFactor: 0.5,
      bearBlocks: true,
      baseRatio: 0.2,
      adds: [
        { drop: 0.3, usdt: 75 },
        { drop: 0.5, usdt: 75 },
        { drop: 0.65, usdt: 75 },
        { drop: 0.8, usdt: 75 },
      ],
      reserve: { usdt: 100, drop: 0.85 },
      takeProfit: [
        { mult: 1.3, ratio: 0.3 },
        { mult: 1.6, ratio: 0.3 },
        { mult: 2, ratio: 0.3 },
      ],
      trailStart: 1.2,
      trailDrawdown: 0.2,
    },
  } satisfies Record<"core" | "alt", Profile>,

  // 组合层面的买入上限（比例以账户净值为基数）
  portfolio: {
    minCashRatio: 0.3, // 买后现金 / 净值不得低于此值
    altNetCap: 0.1, // 山寨币成本合计上限
    coreNetCap: 0.25, // 核心资产成本合计上限
    altMaxCount: 3, // 最多同时持有的山寨币数量（只限制新开）
    weeklyBuyCap: 0.05, // 近 7 天新增买入上限
  },
  reserveStableMin: 2, // 备用金另需企稳项数（V3.3 由 3 项放宽为 2 项）
  minOrderUsdt: 5, // 币安现货最小下单额（约），建议金额低于它就不给买入建议
  // 头仓判定：单笔买入金额 > headMinUsdt 算首笔；或持有余额（按当前价）> headMinUsdt 算首币。
  // 补仓档位和触发价都从头仓算起；达不到的小额持仓不算头仓，系统会继续建议头仓。
  headMinUsdt: 80,
  indicatorProfit: { sellRatio: 0.25, maxRatio: 0.5 }, // 指标止盈：每次卖周期仓的 25%，累计不超过周期仓的 50%
  baseReduce: { mult: 3, rsi: 80, ratio: 0.5 }, // 底仓减仓：价格 ≥ 均价 × 3，且 RSI 与恐惧贪婪同时过热，卖底仓的 50%
  review: { lossLine: 0.5 }, // 浮亏达到 50% 且 BTC 熊市：提示复核基本面

  risk: {
    usdtCny: 7.1, // USDT -> CNY 折算汇率，仅用于总览里的人民币估值
  },
  sell: {
    // 翻倍线：仅用于图表上的目标线和「距翻倍」进度，不触发信号
    levels: [{ ret: 1 }],
  },
};

export type StrategyConfig = typeof strategyConfig;
