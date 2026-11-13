import { strategyConfig, type Profile, type StrategyConfig } from "../strategy.config";
import { closesWithPrice, rsi, sma } from "./indicators";
import type {
  Action,
  Candle,
  CoinInput,
  CoinSignal,
  CoinTag,
  MarketState,
  PortfolioContext,
  Reason,
  ScoreBreakdown,
  Trade,
  Verdict,
  VerdictKind,
} from "./types";

const WEEK = 7 * 864e5;
const PRIORITY: Record<VerdictKind, number> = { sell: 3, strong: 2, accumulate: 1, none: 0 };
const usd = (x: number) => `$${Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2)}`;
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
/** 起算日补的「期初买入」不是真实成交：参与均价和数量，但不算冷却期、不算本周新增。 */
const isSynthetic = (t: Trade) => t.id.startsWith("opening-");

export const isCore = (symbol: string, cfg: StrategyConfig = strategyConfig) => cfg.coreSymbols.includes(symbol);

const none = (over: Partial<Action> = {}): Action => ({
  kind: "none",
  label: "",
  side: "none",
  plannedUsdt: null,
  usdt: null,
  qty: null,
  sellPct: null,
  limits: [],
  blocked: [],
  notes: [],
  ...over,
});

/**
 * BTC 市场状态（全部币种共用）：
 * 收盘 < MA200 且 MA200 比 4 周前低 = 熊市；收盘 ≥ MA200 且 MA200 不低于 4 周前 = 牛市；其余 = 过渡。
 */
export function btcMarketState(weekly: Candle[], price: number, cfg: StrategyConfig = strategyConfig): MarketState | null {
  const closes = closesWithPrice(weekly, price);
  const now = sma(closes, cfg.ma.weeklyPeriod);
  const before = sma(closes.slice(0, -cfg.ma.directionWeeks), cfg.ma.weeklyPeriod);
  if (now === null || before === null) return null;
  const px = closes[closes.length - 1];
  if (px < now && now < before) return "bear";
  if (px >= now && now >= before) return "bull";
  return "transition";
}

/**
 * 企稳三项（数据不足返回 null）：
 * 1. 本周收盘 > 上周最高价
 * 2. 周线 RSI 低于 45 且较上周回升
 * 3. 近 4 周最低价 ≥ 此前 8 周最低价（没有创出新低）
 */
export function stableItems(weekly: Candle[], price: number, cfg: StrategyConfig = strategyConfig): boolean[] | null {
  if (weekly.length < 13) return null;
  const closes = closesWithPrice(weekly, price);
  const now = rsi(closes, cfg.rsi.period);
  const before = rsi(closes.slice(0, -1), cfg.rsi.period);
  const low4 = Math.min(price, ...weekly.slice(-4).map((c) => c.l));
  const low8 = Math.min(...weekly.slice(-12, -4).map((c) => c.l));
  return [
    price > weekly[weekly.length - 2].h,
    now !== null && before !== null && now < cfg.rsi.stabilizeBelow && now > before,
    low4 >= low8,
  ];
}

/**
 * 找出头仓。按时间顺序扫描买入，第一个满足下面任一条的就是头仓：
 * 1. 这一笔的金额 > headMinUsdt：补仓基准价 = 这一笔的价格。
 * 2. 到这一笔为止累计持有的数量，按当前价折合 > headMinUsdt（持有余额够大）：
 *    把到此为止的买入合并成首仓，补仓基准价 = 它们的加权平均成本。
 * 都不满足 = 还没有头仓（小额试水不算）。index 之后的每一笔买入算一档补仓。
 */
export function findHead(buys: Trade[], price: number, cfg: StrategyConfig = strategyConfig): { index: number; basePrice: number } | null {
  const sorted = [...buys].sort((a, b) => a.time - b.time);
  let qty = 0;
  let cost = 0;
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    qty += t.qty;
    cost += t.price * t.qty;
    if (t.price * t.qty > cfg.headMinUsdt) return { index: i, basePrice: t.price };
    if (qty * price > cfg.headMinUsdt) return { index: i, basePrice: cost / qty };
  }
  return null;
}

/** 计算单币评分（不读账户）。 */
export function evaluateCoin(input: CoinInput, ctx: PortfolioContext, cfg: StrategyConfig = strategyConfig): CoinSignal {
  const { price } = input;
  const group = isCore(input.symbol, cfg) ? "core" : "alt";
  const profile = cfg.profiles[group];
  const closes = closesWithPrice(input.weekly, price);
  const weeklyRsi = rsi(closes, cfg.rsi.period);
  const ma200 = sma(closes, cfg.ma.weeklyPeriod);
  const items = stableItems(input.weekly, price, cfg);
  const stableCount = items ? items.filter(Boolean).length : null;

  const reasons: Reason[] = [];
  let rsiPts = 0;
  if (weeklyRsi !== null) {
    const hit = cfg.rsi.tiers.find((t) => weeklyRsi <= t.max);
    if (hit) { rsiPts = hit.points; reasons.push({ key: "rsi", text: `周线 RSI ${weeklyRsi.toFixed(0)} ≤ ${hit.max}（+${hit.points}）` }); }
  }
  let maPts = 0;
  if (ma200 !== null) {
    const ratio = price / ma200;
    const hit = cfg.ma.tiers.find((t) => ratio <= t.max);
    if (hit) { maPts = hit.points; reasons.push({ key: "ma", text: `价格 / 周线 MA200 ${ratio.toFixed(2)} ≤ ${hit.max}（+${hit.points}）` }); }
  }
  // 价格位置：RSI 与 MA 高度相关，取较高者 + 较低者 × 折减系数
  const pricePosition = Math.min(cfg.score.pricePositionCap, Math.max(rsiPts, maPts) + cfg.score.pricePositionDiscount * Math.min(rsiPts, maPts));

  let sentiment = 0;
  const fg = ctx.fearGreed;
  if (fg !== null) {
    const hit = cfg.fearGreed.tiers.find((t) => fg <= t.max);
    if (hit) { sentiment = hit.points; reasons.push({ key: "fg", text: `恐惧贪婪指数 ${fg} ≤ ${hit.max}（+${hit.points}）` }); }
  }
  const trend = (stableCount ?? 0) * cfg.score.trendPerItem;
  if (stableCount) reasons.push({ key: "trend", text: `企稳 ${stableCount} 项（+${trend}）` });
  const score = Math.round(Math.min(cfg.scoreMax, pricePosition + sentiment + trend));
  const breakdown: ScoreBreakdown = { pricePosition: Math.round(pricePosition), sentiment, trend, rsi: rsiPts, ma: maPts };

  const returnPct = input.qty > 0 && input.avgCost !== null ? price / input.avgCost - 1 : null;
  const overheatRsi = weeklyRsi !== null && weeklyRsi > cfg.rsi.overheat;
  const overheatFg = fg !== null && fg >= cfg.fearGreed.overheat;
  const overheat = overheatRsi || overheatFg;
  const stabilized = stableCount !== null && stableCount >= profile.stabilizeMin;

  const action = planAction({ input, ctx, cfg, profile, group, score, stableCount, stabilized, overheat, overheatRsi, overheatFg, weeklyRsi, returnPct });
  const { kind, tag } = classify(action, score, profile);

  return {
    symbol: input.symbol, group, kind, tag, score, breakdown, reasons, action,
    metrics: { weeklyRsi, ma200, fearGreed: fg, stableCount, stabilized: stableCount === null ? null : stabilized, stableItems: items ?? [false, false, false], btcState: ctx.btcState, returnPct },
  };
}

const TAG_BY_KIND: Partial<Record<Action["kind"], CoinTag>> = {
  head: "头仓", add: "补仓", reserve: "备用金",
  takeProfit: "止盈", indicatorProfit: "指标止盈", trailStop: "追踪止损", baseReduce: "底仓减仓",
};

function classify(a: Action, score: number, profile: Profile): { kind: VerdictKind; tag: CoinTag } {
  const tag = TAG_BY_KIND[a.kind];
  if (a.side === "sell" && tag) return { kind: "sell", tag };
  if (a.side === "buy" && tag) return { kind: score >= profile.highScore ? "strong" : "accumulate", tag };
  if (a.blocked.length) return { kind: "none", tag: "暂缓" }; // 分数够，但被门槛或上限挡住
  return { kind: "none", tag: "观望" };
}

interface Ctx {
  input: CoinInput; ctx: PortfolioContext; cfg: StrategyConfig; profile: Profile; group: "core" | "alt";
  score: number; stableCount: number | null; stabilized: boolean; overheat: boolean; overheatRsi: boolean; overheatFg: boolean;
  weeklyRsi: number | null; returnPct: number | null;
}

function planAction(c: Ctx): Action {
  const sell = planSell(c);
  if (sell && sell.side === "sell") return sell;
  const buy = planBuy(c);
  return sell ? { ...buy, notes: [...sell.notes, ...buy.notes] } : buy;
}

/** 卖出类动作，按优先级返回第一个：底仓减仓（最极端）> 止盈档位 > 指标止盈 > 追踪止损。看板读不到卖出记录，所以不知道哪一档已执行。 */
function planSell(c: Ctx): Action | null {
  const { input, ctx, cfg, profile, overheat, overheatRsi, overheatFg, weeklyRsi } = c;
  if (input.qty <= 0 || input.avgCost === null) return null;
  const notes: string[] = [];
  if (c.returnPct !== null && c.returnPct <= -cfg.review.lossLine && ctx.btcState === "bear") notes.push("浮亏过大且 BTC 熊市：请复核基本面（不自动卖出）");

  // 底仓锁定数量 = 累计买入数量 × baseRatio，扣除已减仓
  const boughtQty = input.buys.reduce((s, t) => s + t.qty, 0);
  const baseQty = Math.max(0, boughtQty * profile.baseRatio);
  const cycleQty = Math.max(0, input.qty - baseQty); // 周期仓数量：底仓以外

  // 底仓减仓：价格 ≥ 均价 × 3 且同时过热（RSI > 80 + 恐惧贪婪 ≥ 80）
  const br = cfg.baseReduce;
  if (input.price >= input.avgCost * br.mult && weeklyRsi !== null && weeklyRsi > br.rsi && overheatFg) {
    const planned = boughtQty * profile.baseRatio * br.ratio;
    const qty = Math.min(planned, input.qty);
    if (qty > 0) return { kind: "baseReduce", label: "底仓减仓", side: "sell", plannedUsdt: null, usdt: qty * input.price, qty, sellPct: qty / input.qty, limits: [], blocked: [], notes: [`价格 ≥ 均价 × ${br.mult} 且 RSI > ${br.rsi}、恐惧贪婪 ≥ ${cfg.fearGreed.overheat}`, ...notes] };
  }

  // 止盈档位：取已到达的最高一档。看板读不到卖出记录，已经卖过的档位请自行忽略
  for (let i = profile.takeProfit.length - 1; i >= 0; i--) {
    const tp = profile.takeProfit[i];
    if (input.price < input.avgCost * tp.mult) continue;
    const qty = Math.min(boughtQty * (1 - profile.baseRatio) * tp.ratio, cycleQty);
    if (qty <= 0) continue;
    return { kind: "takeProfit", label: `止盈${i + 1}`, side: "sell", plannedUsdt: null, usdt: qty * input.price, qty, sellPct: qty / input.qty, limits: [], blocked: [], notes: [`价格 ≥ 均价 × ${tp.mult}（档位 ${i + 1}）；读不到卖出记录，已卖过的档位请忽略`, ...notes] };
  }

  // 指标止盈：价格 > 均价，且 RSI 或恐惧贪婪过热
  if (input.price > input.avgCost && overheat && cycleQty > 0) {
    const qty = Math.min(cycleQty * cfg.indicatorProfit.sellRatio, cycleQty);
    const hot = [overheatRsi ? `周线 RSI ${weeklyRsi?.toFixed(0)} > ${cfg.rsi.overheat}` : null, overheatFg ? `恐惧贪婪 ${ctx.fearGreed} ≥ ${cfg.fearGreed.overheat}` : null].filter(Boolean).join("、");
    return { kind: "indicatorProfit", label: "指标止盈", side: "sell", plannedUsdt: null, usdt: qty * input.price, qty, sellPct: qty / input.qty, limits: [], blocked: [], notes: [hot, ...notes] };
  }

  // 追踪止损：价格曾达到均价 × trailStart，自峰值回撤超过阈值
  // 峰值 = 持仓后（第一笔买入所在周起）的最高周收盘价，不是历史最高价
  const firstBuy = Math.min(...input.buys.map((t) => t.time));
  const peak = Math.max(...input.weekly.filter((k) => k.t + WEEK > firstBuy).map((k) => k.c), input.price);
  if (peak >= input.avgCost * profile.trailStart) {
    const line = peak * (1 - profile.trailDrawdown);
    if (input.price <= line && cycleQty > 0) {
      return { kind: "trailStop", label: "追踪止损", side: "sell", plannedUsdt: null, usdt: cycleQty * input.price, qty: cycleQty, sellPct: cycleQty / input.qty, limits: [], blocked: [], notes: [`价格 ${usd(input.price)} ≤ 追踪线 ${usd(line)}（峰值 ${usd(peak)} 回撤 ${pct(cfg.profiles[c.group].trailDrawdown)}）`, ...notes] };
    }
  }

  if (notes.length) return { ...none(), notes };
  return null;
}

/**
 * 买入类动作：头仓 / 补仓 / 备用金。
 * 通用门槛（任一不满足就挡住）：数据完整、BTC 状态可判、分数 ≥ 最低分、企稳项数够、不过热、
 * 山寨币在 BTC 熊市禁止新增、冷却期、山寨币数量上限。
 * 金额 = 表格计划金额 × BTC 状态系数，再被各项上限压低；读不到账户时只给方向，不给金额。
 * 表格里的「组合回撤警戒/熔断」需要净值历史峰值，看板没有这个数据，所以没有实现。
 */
function planBuy(c: Ctx): Action {
  const { input, ctx, cfg, profile, group, score, stableCount, stabilized, overheat } = c;
  const blocked: string[] = [];
  const acc = ctx.account;

  if (input.weekly.length < cfg.ma.weeklyPeriod || c.weeklyRsi === null) blocked.push("周线数据不足 200 根，无法评分");
  if (ctx.btcState === null) blocked.push("BTC 市场状态无法判断");
  if (score < profile.minScore) return none({ notes: [`分数 ${score} 低于${profile.label}买入门槛 ${profile.minScore}`] });
  if (overheat) blocked.push("市场过热，暂停买入");
  if (!stabilized) blocked.push(`未企稳（${stableCount ?? 0}/${profile.stabilizeMin} 项）`);
  if (group === "alt" && profile.bearBlocks && ctx.btcState === "bear") blocked.push("BTC 熊市，山寨币禁止新增");

  const real = input.buys.filter((t) => !isSynthetic(t)).sort((a, b) => a.time - b.time);
  const all = [...input.buys].sort((a, b) => a.time - b.time);
  const last = real.at(-1);
  const cooldown = ctx.btcState === "bear" ? profile.cooldownBearWeeks : profile.cooldownWeeks;
  if (last && (ctx.now - last.time) / WEEK < cooldown) blocked.push(`冷却期未到（距上次买入 ${((ctx.now - last.time) / WEEK).toFixed(1)} 周，需 ≥ ${cooldown} 周）`);

  const head = input.qty > 0 ? findHead(all, input.price, cfg) : null;
  const holding = head !== null;
  if (!holding && group === "alt" && acc.known && acc.altHeldCount >= cfg.portfolio.altMaxCount) blocked.push(`山寨币已持有 ${acc.altHeldCount} 个，达到上限`);

  // 决定这次是头仓、第几档补仓还是备用金
  let kind: "head" | "add" | "reserve" = "head";
  let label = "头仓";
  let planned = score >= profile.highScore && ctx.btcState !== "bear" ? profile.headHigh : profile.headNormal;
  if (head) {
    // 补仓基准价取自头仓；已补几档 = 头仓之后的买入笔数（看板读不到你填的档位名称）
    const basePrice = head.basePrice;
    const filled = Math.min(all.length - 1 - head.index, profile.adds.length);
    if (filled < profile.adds.length) {
      const tier = profile.adds[filled];
      const trigger = basePrice * (1 - tier.drop);
      kind = "add"; label = `补仓${filled + 1}`; planned = tier.usdt;
      if (input.price > trigger) return none({ blocked, notes: [`补仓${filled + 1} 触发价 ${usd(trigger)}（较头仓价 ${usd(basePrice)} 下跌 ${pct(tier.drop)}），当前 ${usd(input.price)} 未到`] });
    } else {
      const trigger = basePrice * (1 - profile.reserve.drop);
      kind = "reserve"; label = "备用金"; planned = profile.reserve.usdt;
      if (input.price > trigger) return none({ blocked, notes: [`4 档补仓已用完；备用金触发价 ${usd(trigger)}（下跌 ${pct(profile.reserve.drop)}），当前 ${usd(input.price)} 未到`] });
      if (ctx.fearGreed === null || ctx.fearGreed > cfg.fearGreed.tiers[0].max) blocked.push(`备用金需极度恐惧（恐惧贪婪 ≤ ${cfg.fearGreed.tiers[0].max}）`);
      if ((stableCount ?? 0) < cfg.reserveStableMin) blocked.push(`备用金需企稳 ≥ ${cfg.reserveStableMin} 项`);
    }
  }

  const factor = ctx.btcState === "bear" ? profile.bearFactor : ctx.btcState === "transition" ? profile.transitionFactor : 1;
  const plannedUsdt = planned * factor;
  const limits: string[] = [];
  let amount = plannedUsdt;
  if (factor < 1) limits.push(`BTC ${ctx.btcState === "bear" ? "熊市" : "过渡市"}，金额 × ${factor}`);

  // 币安现货买不到的品种（如原油）只给方向，不给金额，也不套用账户上限
  const sized = acc.known && !input.signalOnly;
  if (input.signalOnly) limits.push("币安现货没有该品种，只给信号，不给金额");
  if (sized) {
    const caps: [string, number][] = [
      [`单币成本上限 ${usd(profile.capUsdt)}，已投入 ${usd(input.invested)}`, profile.capUsdt - input.invested],
      [`单周新增上限（净值 ${pct(cfg.portfolio.weeklyBuyCap)}），本周已买 ${usd(acc.weeklyBuyUsdt)}`, acc.netWorthUsdt * cfg.portfolio.weeklyBuyCap - acc.weeklyBuyUsdt],
      [`买后现金需 ≥ 净值 ${pct(cfg.portfolio.minCashRatio)}`, acc.cashUsdt - acc.netWorthUsdt * cfg.portfolio.minCashRatio],
      group === "alt"
        ? [`山寨币合计上限（净值 ${pct(cfg.portfolio.altNetCap)}），已占 ${usd(acc.altCostUsdt)}`, acc.netWorthUsdt * cfg.portfolio.altNetCap - acc.altCostUsdt]
        : [`核心资产合计上限（净值 ${pct(cfg.portfolio.coreNetCap)}），已占 ${usd(acc.coreCostUsdt)}`, acc.netWorthUsdt * cfg.portfolio.coreNetCap - acc.coreCostUsdt],
    ];
    for (const [text, room] of caps) {
      if (room < amount) { amount = Math.max(0, room); limits.push(text); }
    }
    if (amount < cfg.minOrderUsdt) blocked.push(`可买金额 ${usd(amount)} 低于最小下单额 ${usd(cfg.minOrderUsdt)}`);
  }

  if (blocked.length) return none({ kind, label, plannedUsdt, limits, blocked });
  return { kind, label, side: "buy", plannedUsdt, usdt: sized ? amount : null, qty: sized ? amount / input.price : null, sellPct: null, limits, blocked: [], notes: [] };
}




/** 今日结论：卖出 > 强烈买入 > 加仓类 > 不宜操作。被风控挡住的「暂缓」不算信号。 */
export function buildVerdict(signals: CoinSignal[]): Verdict {
  const actionable = (s: CoinSignal) => (s.tag === "暂缓" || s.tag === "观望" ? "none" : s.kind);
  const rank = (s: CoinSignal) => PRIORITY[actionable(s) as VerdictKind];
  const sorted = [...signals].sort((a, b) => rank(b) - rank(a) || b.score - a.score);
  const primary = sorted[0] && rank(sorted[0]) > 0 ? sorted[0] : null;
  if (!primary) return { kind: "none", primary: null, others: sorted, reasons: [] };
  const reasons: Reason[] = [
    ...primary.action.notes.map((text, i) => ({ key: `n${i}`, text })),
    ...primary.reasons,
  ];
  return { kind: primary.kind, primary, others: sorted.filter((s) => s !== primary), reasons: reasons.slice(0, 3) };
}
