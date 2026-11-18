import { describe, expect, it } from "vitest";
import { btcMarketState, buildVerdict, evaluateCoin, findHead, stableItems } from "./engine";
import type { Action, Candle, CoinInput, CoinSignal, PortfolioContext, Trade } from "./types";

const WEEK = 7 * 864e5;
const candles = (closes: number[], spread = 0.02): Candle[] =>
  closes.map((c, i) => ({ t: i * WEEK, o: c, h: c * (1 + spread), l: c * (1 - spread), c, v: 1 }));
const flat = (n: number, v: number) => Array.from({ length: n }, () => v);
const ramp = (from: number, to: number, n: number) =>
  Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 1)) / n);

/** 200 周横盘 -> 急跌到 40 -> 横盘 -> 小幅回升：RSI 很低、价格低于 MA200、企稳 3 项全满足。满分 90。 */
const bottoming = () => [...flat(200, 100), ...ramp(100, 40, 16), ...flat(8, 40), 40.5, 41, 41.5, 43];
/** 同样的下跌，但最后一周仍在创新低：同样 75 分，但企稳 0 项。 */
const falling = () => [...flat(200, 100), ...ramp(100, 40, 22)];
/** 价格高于 MA200 约 6%，RSI 约 52：价格位置不得分。 */
const calm = () => [...flat(190, 100), ...Array.from({ length: 70 }, (_, i) => (i % 2 === 0 ? 110 : 111))];

const account = { known: true, cashUsdt: 5000, netWorthUsdt: 10000, coreCostUsdt: 0, altCostUsdt: 0, altHeldCount: 0, weeklyBuyUsdt: 0 };
const ctx = (over: Partial<PortfolioContext> = {}): PortfolioContext => ({ fearGreed: 20, btcState: "bull", account, now: 300 * WEEK, ...over });
const withAccount = (over: Partial<typeof account>) => ({ account: { ...account, ...over } });

const trade = (price: number, qty: number, weeks: number, id = `t${weeks}`): Trade => ({ id, symbol: "X", time: weeks * WEEK, price, qty, fee: 0, source: "binance" });

function coin(closes: number[], over: Partial<CoinInput> = {}): CoinInput {
  return { symbol: "BTC", price: closes.at(-1)!, weekly: candles(closes), qty: 0, avgCost: null, invested: 0, marketValue: 0, buys: [], ...over };
}
/** 持仓币：买入记录决定均价和数量。 */
function held(closes: number[], buys: Trade[], over: Partial<CoinInput> = {}): CoinInput {
  const qty = buys.reduce((s, t) => s + t.qty, 0);
  const invested = buys.reduce((s, t) => s + t.price * t.qty, 0);
  const price = over.price ?? closes.at(-1)!;
  return coin(closes, { qty, avgCost: invested / qty, invested, marketValue: qty * price, buys, ...over });
}

describe("BTC 市场状态", () => {
  it("收盘 >= MA200 且 MA200 不下行 -> 牛市", () => {
    expect(btcMarketState(candles([...flat(200, 100), ...ramp(100, 120, 20)]), 120)).toBe("bull");
  });
  it("收盘 < MA200 且 MA200 下行 -> 熊市", () => {
    expect(btcMarketState(candles(falling()), 40)).toBe("bear");
  });
  it("收盘 < MA200 但 MA200 仍上行 -> 过渡", () => {
    expect(btcMarketState(candles([...ramp(50, 150, 260), 60]), 60)).toBe("transition");
  });
  it("数据不足 200 周 -> null", () => {
    expect(btcMarketState(candles(flat(100, 100)), 100)).toBeNull();
  });
});

describe("企稳三项", () => {
  it("底部回升：三项全满足", () => {
    expect(stableItems(candles(bottoming()), 43)).toEqual([true, true, true]);
  });
  it("仍在创新低：三项全不满足", () => {
    expect(stableItems(candles(falling()), 40)).toEqual([false, false, false]);
  });
  it("数据太少 -> null", () => {
    expect(stableItems(candles([1, 2, 3]), 3)).toBeNull();
  });
});

describe("打分", () => {
  it("满分 90：价格位置 45（RSI 与 MA 折减合并）+ 情绪 30 + 企稳 15", () => {
    const s = evaluateCoin(coin(bottoming()), ctx());
    expect(s.breakdown).toMatchObject({ rsi: 30, ma: 30, pricePosition: 45, sentiment: 30, trend: 15 });
    expect(s.score).toBe(90);
  });
  it("RSI 与 MA 同为 30 分时不会加到 60，而是 30 + 30×0.5 = 45", () => {
    expect(evaluateCoin(coin(falling()), ctx()).breakdown.pricePosition).toBe(45);
  });
  it("取不到恐惧贪婪：情绪项为 0，不崩溃", () => {
    const s = evaluateCoin(coin(bottoming()), ctx({ fearGreed: null }));
    expect(s.breakdown.sentiment).toBe(0);
    expect(s.score).toBe(60);
  });
  it("评分不受账户影响", () => {
    const a = evaluateCoin(coin(bottoming()), ctx());
    const b = evaluateCoin(coin(bottoming()), ctx(withAccount({ cashUsdt: 0, netWorthUsdt: 1 })));
    expect(b.score).toBe(a.score);
  });
  it("积极型（BTC/PAXG）与保守型（其余）", () => {
    expect(evaluateCoin(coin(calm(), { symbol: "PAXG" }), ctx()).group).toBe("core");
    expect(evaluateCoin(coin(calm(), { symbol: "ETH" }), ctx()).group).toBe("alt");
  });
});

describe("头仓", () => {
  it("积极型 BTC 高分头仓 $200，牛市系数 1", () => {
    const s = evaluateCoin(coin(bottoming()), ctx());
    expect(s.tag).toBe("头仓");
    expect(s.kind).toBe("strong");
    expect(s.action.usdt).toBe(200);
  });
  it("保守型 90 分才是高分头仓：UNI $100", () => {
    const s = evaluateCoin(coin(bottoming(), { symbol: "UNI" }), ctx());
    expect(s.action.usdt).toBe(100);
  });
  it("BTC 过渡市：金额 × 0.85", () => {
    expect(evaluateCoin(coin(bottoming()), ctx({ btcState: "transition" })).action.usdt).toBeCloseTo(170, 6);
  });
  it("BTC 熊市：积极型降为常规头仓 $150 × 0.7", () => {
    expect(evaluateCoin(coin(bottoming()), ctx({ btcState: "bear" })).action.usdt).toBeCloseTo(105, 6);
  });
  it("BTC 熊市：保守型禁止新增", () => {
    const s = evaluateCoin(coin(bottoming(), { symbol: "UNI" }), ctx({ btcState: "bear" }));
    expect(s.tag).toBe("暂缓");
    expect(s.action.blocked.join()).toContain("禁止新增");
  });
  it("分数够但未企稳 -> 暂缓", () => {
    const s = evaluateCoin(coin(falling()), ctx());
    expect(s.score).toBe(75);
    expect(s.tag).toBe("暂缓");
    expect(s.action.blocked.join()).toContain("未企稳");
  });
  it("分数低于买入门槛 -> 观望，并写明原因", () => {
    const s = evaluateCoin(coin(calm()), ctx());
    expect(s.tag).toBe("观望");
    expect(s.action.notes.join()).toContain("买入门槛");
  });
  it("BTC 状态无法判断 -> 暂缓", () => {
    const s = evaluateCoin(coin(bottoming()), ctx({ btcState: null }));
    expect(s.tag).toBe("暂缓");
  });
  it("山寨币已持有 3 个时不再新开", () => {
    const s = evaluateCoin(coin(bottoming(), { symbol: "UNI" }), ctx(withAccount({ altHeldCount: 3 })));
    expect(s.tag).toBe("暂缓");
    expect(s.action.blocked.join()).toContain("上限");
  });
});

describe("固定额度（不依赖账户规模）", () => {
  it("账户现金很少、单周买入很多，也不缩减策略计划；余额由执行队列处理", () => {
    const s = evaluateCoin(coin(bottoming()), ctx(withAccount({ cashUsdt: 6, netWorthUsdt: 6, weeklyBuyUsdt: 9999 })));
    expect(s.action.usdt).toBe(200);
  });
  it("账户数据未知时仍给出固定计划金额", () => {
    const s = evaluateCoin(coin(bottoming()), ctx(withAccount({ known: false, cashUsdt: 0 })));
    expect(s.action.side).toBe("buy");
    expect(s.action.usdt).toBe(200);
  });
  it("BTC/PAXG 使用 1000 USDT 上限；ETH/其他币使用 500 USDT 上限", () => {
    expect(evaluateCoin(coin(bottoming(), { symbol: "BTC" }), ctx()).action.usdt).toBe(200);
    expect(evaluateCoin(coin(bottoming(), { symbol: "PAXG" }), ctx()).action.usdt).toBe(200);
    expect(evaluateCoin(coin(bottoming(), { symbol: "ETH" }), ctx()).action.usdt).toBe(100);
  });
  it("单币累计成本上限：已投入 950 USDT 时核心币最多计划 50 USDT", () => {
    const s = evaluateCoin(coin(bottoming(), { invested: 950 }), ctx());
    expect(s.action.usdt).toBeCloseTo(50, 6);
    expect(s.action.limits.join()).toContain("单币累计成本上限");
  });
  it("单币额度剩余低于最小下单额时暂缓", () => {
    const s = evaluateCoin(coin(bottoming(), { invested: 997 }), ctx());
    expect(s.tag).toBe("暂缓");
    expect(s.action.blocked.join()).toContain("最小下单额");
  });
});

describe("补仓与备用金", () => {
  it("头仓价 60，跌到 51 以下 -> 补仓1 $150", () => {
    const s = evaluateCoin(held(bottoming(), [trade(60, 2, 250)]), ctx());
    expect(s.tag).toBe("补仓");
    expect(s.action.label).toBe("补仓1");
    expect(s.action.usdt).toBe(150);
  });
  it("已补过一档 -> 下一次是补仓2", () => {
    const s = evaluateCoin(held(bottoming(), [trade(70, 2, 250), trade(60, 2, 260)]), ctx());
    expect(s.action.label).toBe("补仓2");
  });
  it("价格没跌到触发价 -> 观望，并写明触发价", () => {
    const s = evaluateCoin(held(bottoming(), [trade(50, 2, 250)]), ctx());
    expect(s.tag).toBe("观望");
    expect(s.action.notes.join()).toContain("触发价");
  });
  it("距上次真实买入不足冷却周数 -> 暂缓", () => {
    const s = evaluateCoin(held(bottoming(), [trade(60, 2, 299)]), ctx());
    expect(s.tag).toBe("暂缓");
    expect(s.action.blocked.join()).toContain("冷却");
  });
  it("起算日补的期初买入不算冷却", () => {
    const opening = trade(60, 2, 299, "opening-BTC");
    expect(evaluateCoin(held(bottoming(), [opening]), ctx()).tag).toBe("补仓");
  });
  it("4 档补仓用完后进入备用金 $200", () => {
    const buys = [110, 100, 100, 100, 100].map((p, i) => trade(p, 1, 200 + i * 10));
    const s = evaluateCoin(held(bottoming(), buys), ctx());
    expect(s.tag).toBe("备用金");
    expect(s.action.usdt).toBe(200);
  });
  it("备用金需极度恐惧：恐惧贪婪 30 -> 暂缓", () => {
    const buys = [110, 100, 100, 100, 100].map((p, i) => trade(p, 1, 200 + i * 10));
    const s = evaluateCoin(held(bottoming(), buys), ctx({ fearGreed: 30 }));
    expect(s.tag).toBe("暂缓");
    expect(s.action.blocked.join()).toContain("极度恐惧");
  });
  it("首笔金额 ≤ $80 不算头仓：继续建议头仓，而不是补仓", () => {
    const s = evaluateCoin(held(bottoming(), [trade(60, 1, 250)]), ctx());
    expect(s.tag).toBe("头仓");
  });
  it("首笔恰好 $80 不算（需 > $80）", () => {
    expect(findHead([trade(80, 1, 250)], 43)).toBeNull();
    expect(findHead([trade(80.01, 1, 250)], 43)).not.toBeNull();
  });
  it("小额试水后再买一笔 > $80：后一笔才是头仓，补仓基准价取它", () => {
    const head = findHead([trade(50, 1, 240), trade(70, 2, 250)], 43);
    expect(head).toEqual({ index: 1, basePrice: 70 });
  });
  it("小额多笔累计持有价值 > $80 也算首币，基准价取它们的加权均价", () => {
    // 每笔都 ≤ $80；当前价 60：第 1 笔时 1×60 = $60，第 2 笔时 2×60 = $120 > $80，所以第 2 笔起算首仓
    const head = findHead([trade(50, 1, 240), trade(60, 1, 245), trade(70, 1, 250)], 60);
    expect(head).toEqual({ index: 1, basePrice: 55 });
  });
  it("头仓之前的小额买入不计补仓档位", () => {
    // 先买 $50 小额，再买 $140 头仓（70×2），之后没补过：下一次应是补仓1，不是补仓2
    const s = evaluateCoin(held(bottoming(), [trade(50, 1, 230), trade(70, 2, 250)]), ctx());
    expect(s.action.label).toBe("补仓1");
  });
  it("单币成本上限：已投入 $950 时补仓 $150 只能买 $50", () => {
    const s = evaluateCoin(held(bottoming(), [trade(60, 2, 250)], { invested: 950 }), ctx());
    expect(s.action.usdt).toBeCloseTo(50, 6);
    expect(s.action.limits.join()).toContain("单币成本上限");
  });
});

describe("卖出", () => {
  // BTC 止盈倍数：2 / 3 / 5。构造一段上涨走势，持仓均价低
  const rising = () => [...flat(200, 100), ...ramp(100, 250, 20)];
  it("价格 ≥ 均价 × 2：止盈1", () => {
    const s = evaluateCoin(held(rising(), [trade(100, 1, 200)]), ctx());
    expect(s.tag).toBe("止盈");
    expect(s.action.label).toBe("止盈1");
    expect(s.action.sellPct).toBeGreaterThan(0);
  });
  it("价格到达 ×3 只给最高一档（止盈2），不同时触发多个", () => {
    const closes = [...flat(200, 100), ...ramp(100, 340, 20)];
    const s = evaluateCoin(held(closes, [trade(100, 1, 200)], { price: 340 }), ctx());
    expect(s.action.label).toBe("止盈2");
  });
  it("指标止盈：价格高于均价 + RSI 过热 -> 卖周期仓的 25%", () => {
    const closes = [...flat(40, 100), ...ramp(100, 180, 20)];
    const s = evaluateCoin(held(closes, [trade(100, 1, 40)], { price: 180 }), ctx());
    expect(s.tag).toBe("指标止盈");
    expect(s.action.sellPct).toBeCloseTo(0.25 * (1 - 0.4), 2);
  });
  it("追踪止损：曾达均价 × 1.3，回撤 30%", () => {
    const closes = [...flat(190, 100), ...flat(10, 180), 180, 180, 120];
    const s = evaluateCoin(held(closes, [trade(100, 1, 180)], { price: 120 }), ctx());
    expect(s.tag).toBe("追踪止损");
    expect(s.action.notes.join()).toContain("追踪线");
  });
  it("峰值只看持仓之后：买入前的历史高位不触发止损", () => {
    const closes = [...flat(10, 100), ...ramp(100, 500, 20), ...ramp(500, 100, 20), ...flat(170, 100), 100];
    const s = evaluateCoin(held(closes, [trade(100, 1, 250)], { price: 100 }), ctx());
    expect(s.tag).not.toBe("追踪止损");
  });
  it("持仓浮亏 ≥ 50% 且 BTC 熊市：提示复核但不自动卖", () => {
    const closes = [...flat(200, 100), ...ramp(100, 30, 22)];
    const s = evaluateCoin(held(closes, [trade(100, 1, 250)], { price: 30 }), ctx({ btcState: "bear" }));
    expect(s.action.side).not.toBe("sell");
    expect(s.action.notes.join()).toContain("复核基本面");
  });
});

describe("今日结论", () => {
  const sig = (symbol: string, kind: CoinSignal["kind"], tag: CoinSignal["tag"], score: number): CoinSignal => ({
    symbol, group: "alt", kind, tag, score,
    breakdown: { pricePosition: 0, sentiment: 0, trend: 0, rsi: 0, ma: 0 },
    reasons: [], action: { kind: "none", label: "", side: "none", plannedUsdt: null, usdt: null, qty: null, sellPct: null, limits: [], blocked: [], notes: [] },
    metrics: { weeklyRsi: null, ma200: null, fearGreed: null, stableCount: null, stabilized: null, stableItems: [false, false, false], btcState: null, returnPct: null },
  });
  it("都没触发 -> none", () => {
    expect(buildVerdict([sig("A", "none", "观望", 0)]).kind).toBe("none");
  });
  it("优先级：sell > strong > accumulate；暂缓不算触发", () => {
    const v = buildVerdict([
      sig("A", "accumulate", "补仓", 55),
      sig("B", "strong", "头仓", 85),
      sig("C", "none", "暂缓", 70),
      sig("D", "sell", "止盈", 0),
    ]);
    expect(v.primary?.symbol).toBe("D");
  });
  it("同级别按分数排序", () => {
    const v = buildVerdict([sig("A", "accumulate", "补仓", 60), sig("B", "accumulate", "补仓", 80)]);
    expect(v.primary?.symbol).toBe("B");
  });
});
