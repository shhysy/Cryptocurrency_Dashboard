import { strategyConfig, type StrategyConfig } from "../strategy.config";
import { closesWithPrice, highestHigh, rsi, sma } from "./indicators";
import type {
  CoinInput,
  CoinSignal,
  CoinTag,
  PortfolioContext,
  Reason,
  Verdict,
  VerdictKind,
} from "./types";

const PRIORITY: Record<VerdictKind, number> = { sell: 4, risk: 3, strong: 2, accumulate: 1, none: 0 };
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

export function evaluateCoin(
  input: CoinInput,
  ctx: PortfolioContext,
  cfg: StrategyConfig = strategyConfig,
): CoinSignal {
  const { price } = input;
  const weeklyCloses = closesWithPrice(input.weekly, price);
  const weeklyRsi = rsi(weeklyCloses, cfg.rsi.period);
  const monthlyRsi = rsi(closesWithPrice(input.monthly, price), cfg.rsi.period);
  const high = highestHigh(input.weekly, cfg.drawdown.lookbackWeeks, price);
  const drawdown = high ? Math.max(0, 1 - price / high) : null;

  let ma200 = sma(weeklyCloses, cfg.ma.weeklyPeriod);
  let ma200Source: "weekly" | "monthly" | null = ma200 !== null ? "weekly" : null;
  if (ma200 === null) {
    ma200 = sma(closesWithPrice(input.monthly, price), cfg.ma.monthlyFallbackPeriod);
    if (ma200 !== null) ma200Source = "monthly";
  }
  const ma50 = sma(weeklyCloses, cfg.ma.deviationPeriod);
  const ma50Deviation = ma50 ? price / ma50 - 1 : null;

  const hasPosition = input.qty > 0 && input.avgCost !== null;
  const returnPct = hasPosition ? price / (input.avgCost as number) - 1 : null;
  const weight = ctx.totalValueUsdt > 0 ? input.marketValue / ctx.totalValueUsdt : 0;

  // ---------- 卖出 ----------
  const sellReasons: Reason[] = [];
  let sellMin: number | null = null;
  let sellMax: number | null = null;
  // 默认不使用成本类信号（cfg.useCostSignals = false）：只看价格、周线 RSI、MA
  if (cfg.useCostSignals ? returnPct !== null : input.qty > 0) {
    const hit = cfg.useCostSignals
      ? [...cfg.sell.levels].reverse().find((l) => returnPct !== null && returnPct >= l.ret)
      : undefined;
    if (hit) {
      sellMin = hit.min;
      sellMax = hit.max;
      sellReasons.push({
        key: "sell-return",
        text: `收益率 +${pct(returnPct ?? 0)}，已达 +${pct(hit.ret)} 档，可分批止盈、先收回本金`,
      });
    }
    if (weeklyRsi !== null && weeklyRsi > cfg.rsi.weeklySell && (!cfg.useCostSignals || (returnPct ?? 0) > 0)) {
      sellMin = Math.max(sellMin ?? 0, cfg.sell.rsiHot.min);
      sellMax = Math.max(sellMax ?? 0, cfg.sell.rsiHot.max);
      sellReasons.push({
 key: "sell-rsi",
 text: `周线 RSI ${weeklyRsi.toFixed(0)} > ${cfg.rsi.weeklySell}${cfg.useCostSignals ? "，且持仓为正收益" : "，市场明显过热"}`,
      });
    }
  }

  // ---------- 风险暂停 ----------
  const riskReasons: Reason[] = [];
  let overheated = false;
  if (weeklyRsi !== null && weeklyRsi > cfg.rsi.weeklyOverheated) {
    overheated = true;
    riskReasons.push({
      key: "risk-rsi",
      text: `周线 RSI ${weeklyRsi.toFixed(0)} > ${cfg.rsi.weeklyOverheated}，市场偏热`,
    });
  }
  if (ma50Deviation !== null && ma50Deviation > cfg.ma.overheatDeviation) {
    overheated = true;
    riskReasons.push({
      key: "risk-ma50",
      text: `价格高于周线 MA50 ${pct(ma50Deviation)}，偏离过大`,
    });
  }
  const overWeight = weight > cfg.risk.maxCoinWeight;
  // 上限按「当前持仓市值」折算人民币比较，不看累计投入（加仓是用户自己操作的）
  const totalCny = ctx.totalValueUsdt * cfg.risk.usdtCny;
  const overCapital = totalCny >= cfg.risk.maxTotalCapitalCny;

  // ---------- 买入 / 加仓 ----------
  const buy: { reason: Reason; points: number; addPct: number }[] = [];
  let strongRsi = false;
  if (weeklyRsi !== null && weeklyRsi < cfg.rsi.weeklyBuy) {
    strongRsi = weeklyRsi < cfg.rsi.weeklyStrongBuy;
    buy.push({
      reason: {
        key: "buy-rsi",
        text: strongRsi
   ? `周线 RSI ${weeklyRsi.toFixed(0)} < ${cfg.rsi.weeklyStrongBuy}，进入强烈买入区`
   : `周线 RSI ${weeklyRsi.toFixed(0)} < ${cfg.rsi.weeklyBuy}，处于偏低区间`,
      },
      points: strongRsi ? cfg.score.rsiStrong : cfg.score.rsiBuy,
      addPct: strongRsi ? 15 : 10,
    });
  }
  if (drawdown !== null) {
    const tiers = cfg.drawdown.tiers;
    let idx = -1;
    tiers.forEach((t, i) => {
      if (drawdown >= t.dd) idx = i;
    });
    if (idx >= 0) {
      buy.push({
 reason: {
   key: "buy-dd",
   text: `较 52 周高点回撤 ${pct(drawdown)}，达 ${pct(tiers[idx].dd)} 档（${tiers[idx].label}）`,
        },
 points: cfg.score.drawdownByTier[idx] ?? 10,
        addPct: tiers[idx].addPct,
      });
    }
  }
  if (ma200 !== null && price <= ma200 * (1 + cfg.ma.nearPct)) {
    buy.push({
      reason: {
        key: "buy-ma",
 text: `价格接近或低于${ma200Source === "weekly" ? "周线 MA200" : "月线 MA20"}（${ma200.toFixed(2)}），长期支撑区`,
      },
      points: cfg.score.maNear,
      addPct: 5,
    });
  }
  if (monthlyRsi !== null && monthlyRsi <= cfg.rsi.monthlyLow) {
    buy.push({
      reason: { key: "buy-mrsi", text: `月线 RSI ${monthlyRsi.toFixed(0)}，处于历史低位区` },
      points: cfg.score.monthlyRsiLow,
      addPct: 5,
    });
  }
  if (cfg.useCostSignals && returnPct !== null && returnPct <= cfg.cost.belowCostPct) {
    buy.push({
      reason: { key: "buy-cost", text: `低于平均成本 ${pct(-returnPct)}，可考虑摊低成本` },
      points: cfg.score.belowCost,
      addPct: cfg.cost.addPct,
    });
  }

  let score = buy.reduce((s, b) => s + b.points, 0);
  if (overheated) score -= cfg.score.overheatPenalty;
  score = Math.max(0, Math.min(100, Math.round(score)));

  // ---------- 判定 ----------
  let kind: VerdictKind = "none";
  let tag: CoinTag = "观望";
  let reasons: Reason[] = [];
  let addPct: number | null = null;

  const limitReasons: Reason[] = [];
  if (overWeight) {
    limitReasons.push({
      key: "risk-weight",
      text: `仓位占比 ${pct(weight)} 超过上限 ${pct(cfg.risk.maxCoinWeight)}，建议再平衡`,
    });
  }
  if (overCapital) {
    limitReasons.push({
      key: "risk-capital",
      text: `持仓市值约 ¥${Math.round(totalCny).toLocaleString("en-US")}，已达上限 ¥${cfg.risk.maxTotalCapitalCny.toLocaleString("en-US")}`,
    });
  }

  if (sellReasons.length) {
    kind = "sell";
    tag = "可卖出";
    reasons = sellReasons;
  } else if (overheated) {
    kind = "risk";
    tag = "过热";
    reasons = riskReasons;
  } else if (buy.length && limitReasons.length) {
    kind = "risk";
    tag = "观望";
    reasons = limitReasons;
  } else if (buy.length) {
    const strong = strongRsi || score >= cfg.thresholds.strongScore;
    if (strong || score >= cfg.thresholds.accumulateScore) {
      kind = strong ? "strong" : "accumulate";
      tag = "加仓区";
      reasons = [...buy].sort((a, b) => b.points - a.points).map((b) => b.reason);
      addPct = Math.max(...buy.map((b) => b.addPct));
    }
  }

  const room = Math.max(0, cfg.risk.maxTotalCapitalCny - totalCny);
  const addAmountCny = addPct !== null ? Math.round((room * addPct) / 100) : null;

  return {
    symbol: input.symbol,
    kind,
    tag,
    score,
    reasons,
    addPct,
    addAmountCny,
    sellMin: kind === "sell" ? sellMin : null,
    sellMax: kind === "sell" ? sellMax : null,
    metrics: { weeklyRsi, monthlyRsi, drawdown, ma200, ma200Source, ma50Deviation, returnPct, weight },
  };
}

/** 今日结论：卖出 > 风险暂停 > 强烈买入 > 适合加仓 > 不宜操作。 */
export function buildVerdict(signals: CoinSignal[]): Verdict {
  const sorted = [...signals].sort(
    (a, b) => PRIORITY[b.kind] - PRIORITY[a.kind] || b.score - a.score,
  );
  const primary = sorted[0] && sorted[0].kind !== "none" ? sorted[0] : null;
  if (!primary) return { kind: "none", primary: null, others: sorted, reasons: [] };
  return {
    kind: primary.kind,
    primary,
    others: sorted.filter((s) => s !== primary),
    reasons: primary.reasons.slice(0, 3),
  };
}
