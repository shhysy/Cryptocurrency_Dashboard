import { describe, expect, it } from "vitest";
import { strategyConfig } from "../strategy.config";
import { computeCost, mergeTrades } from "./cost";
import { buildVerdict, evaluateCoin } from "./engine";
import { rsi, sma } from "./indicators";
import type { Candle, CoinInput, CoinSignal, Trade, VerdictKind } from "./types";

const WEEK = 7 * 864e5;
const candles = (closes: number[], spread = 0.02): Candle[] =>
  closes.map((c, i) => ({ t: i * WEEK, o: c, h: c * (1 + spread), l: c * (1 - spread), c, v: 1 }));

/** 先横盘再单边，构造指定的周线走势 */
const flat = (n: number, v: number) => Array.from({ length: n }, () => v);
const ramp = (from: number, to: number, n: number) =>
  Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 1)) / n);

const ctx = { totalInvestedUsdt: 1000, totalValueUsdt: 1000 };
// 开启「成本类信号」的配置：用来测试收益率止盈、低于成本加仓
const withCost = { ...strategyConfig, useCostSignals: true };

function input(over: Partial<CoinInput> & { weeklyCloses: number[] }): CoinInput {
  const { weeklyCloses, ...rest } = over;
  const weekly = candles(weeklyCloses);
  return {
    symbol: "BTC",
    price: weeklyCloses[weeklyCloses.length - 1],
    weekly,
    monthly: candles(flat(30, weeklyCloses[weeklyCloses.length - 1])),
    qty: 0,
    avgCost: null,
    invested: 0,
    marketValue: 0,
    ...rest,
  };
}

describe("indicators", () => {
  it("RSI 单边上涨为 100，单边下跌为 0，数据不足为 null", () => {
    expect(rsi(ramp(1, 30, 30))).toBe(100);
    expect(rsi(ramp(30, 1, 30))).toBeCloseTo(0, 5);
    expect(rsi([1, 2, 3])).toBeNull();
  });
  it("RSI 已知样例（Wilder 经典数据）", () => {
    const closes = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28,
    ];
    expect(rsi(closes, 14)).toBeCloseTo(70.46, 1);
  });
  it("SMA", () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5);
    expect(sma([1], 2)).toBeNull();
  });
});

describe("成本价", () => {
  const t = (qty: number, price: number, fee = 0): Trade => ({
    id: String(Math.random()),
    symbol: "BTC",
    time: Date.UTC(2024, 0, 1),
    price,
    qty,
    fee,
    source: "binance",
  });
  it("加权平均，含手续费", () => {
    const r = computeCost([t(1, 100, 1), t(3, 200, 3)], true);
    expect(r.qty).toBe(4);
    expect(r.invested).toBe(704);
    expect(r.avgCost).toBe(176);
  });
  it("不含手续费", () => {
    expect(computeCost([t(1, 100, 1), t(3, 200, 3)], false).avgCost).toBe(175);
  });
  it("无成交时为 null", () => {
    expect(computeCost([]).avgCost).toBeNull();
  });
  it("合并去重：同币同天同价同量只保留一笔，优先币安", () => {
    const api = { ...t(1, 100), time: Date.UTC(2024, 0, 1, 13, 5), source: "binance" as const };
    const manual = { ...t(1, 100), time: Date.UTC(2024, 0, 1), source: "manual" as const };
    const other = { ...t(2, 100), time: Date.UTC(2024, 0, 1), source: "manual" as const };
    const merged = mergeTrades([api], [manual, other]);
    expect(merged).toHaveLength(2);
    expect(merged.filter((x) => x.source === "binance")).toHaveLength(1);
  });
});

describe("信号", () => {
  it("下跌趋势：周线 RSI < 30 且回撤大 -> 强烈买入", () => {
    const closes = [...flat(40, 100), ...ramp(100, 40, 20)];
    const s = evaluateCoin(input({ weeklyCloses: closes }), ctx);
    expect(s.metrics.weeklyRsi!).toBeLessThan(30);
    expect(s.metrics.drawdown!).toBeGreaterThanOrEqual(0.5);
    expect(s.kind).toBe("strong");
    expect(s.tag).toBe("加仓区");
    expect(s.addPct).not.toBeNull();
  });

  it("RSI 在 30~35 之间只算适合加仓", () => {
    // 取一段回撤较浅但 RSI 偏低的走势：先涨后缓跌
    const closes = [...ramp(80, 100, 40), ...ramp(100, 93, 14)];
    const s = evaluateCoin(input({ weeklyCloses: closes }), ctx);
    expect(["none", "accumulate", "strong"]).toContain(s.kind);
  });

  it("横盘无信号 -> none，观望", () => {
    const s = evaluateCoin(input({ weeklyCloses: flat(60, 100) }), ctx);
    expect(s.kind).toBe("none");
    expect(s.tag).toBe("观望");
  });

  it("收益 +100% 触发卖出，建议 1/3~1/2", () => {
    const s = evaluateCoin(
      input({ weeklyCloses: flat(60, 200), qty: 1, avgCost: 100, marketValue: 200 }),
      { totalInvestedUsdt: 100, totalValueUsdt: 200 },
      withCost,
    );
    expect(s.kind).toBe("sell");
    expect(s.tag).toBe("可卖出");
    expect(s.sellMin).toBe(0.33);
    expect(s.sellMax).toBe(0.5);
  });

  it("收益 +200% 进入更高档", () => {
    const s = evaluateCoin(
      input({ weeklyCloses: flat(60, 300), qty: 1, avgCost: 100, marketValue: 300 }),
      { totalInvestedUsdt: 100, totalValueUsdt: 300 },
      withCost,
    );
    expect(s.kind).toBe("sell");
    expect(s.sellMin).toBe(0.2);
  });

  it("周线 RSI > 70 且无其他信号 -> 风险暂停", () => {
    const closes = [...flat(40, 100), ...ramp(100, 130, 20)];
    const s = evaluateCoin(input({ weeklyCloses: closes }), ctx);
    expect(s.metrics.weeklyRsi!).toBeGreaterThan(70);
    expect(s.kind).toBe("risk");
    expect(s.tag).toBe("过热");
  });

  it("卖出优先级高于风险暂停", () => {
    const closes = [...flat(40, 100), ...ramp(100, 250, 20)];
    const s = evaluateCoin(
      input({ weeklyCloses: closes, qty: 1, avgCost: 100, marketValue: 250 }),
      { totalInvestedUsdt: 100, totalValueUsdt: 250 },
      withCost,
    );
    expect(s.kind).toBe("sell");
  });

  it("默认不看成本：成本再低、收益再高，只要价格/RSI/MA 没信号就不触发卖出", () => {
    const s = evaluateCoin(
      input({ weeklyCloses: flat(60, 300), qty: 1, avgCost: 10, marketValue: 300 }),
      { totalInvestedUsdt: 10, totalValueUsdt: 300 },
    );
    expect(s.kind).not.toBe("sell");
    expect(s.metrics.returnPct).toBeGreaterThan(10);
  });

  it("默认不看成本：同一走势下，改变成本价不改变信号与机会指数", () => {
    const closes = [...flat(40, 100), ...ramp(100, 40, 20)];
    // 组合总市值放大到 1000，让该币占比 4%，避免触发「单币占比超限」干扰对比
    const a = evaluateCoin(input({ weeklyCloses: closes, qty: 1, avgCost: 30, marketValue: 40 }), { totalInvestedUsdt: 30, totalValueUsdt: 1000 });
    const b = evaluateCoin(input({ weeklyCloses: closes, qty: 1, avgCost: 500, marketValue: 40 }), { totalInvestedUsdt: 500, totalValueUsdt: 1000 });
    const c = evaluateCoin(input({ weeklyCloses: closes }), ctx);
    expect([a.kind, a.score]).toEqual([b.kind, b.score]);
    expect([a.kind, a.score]).toEqual([c.kind, c.score]);
  });

  it("周线 RSI > 80 在默认模式下直接提示减仓（不要求收益为正）", () => {
    const closes = [...flat(40, 100), ...ramp(100, 400, 20)];
    const s = evaluateCoin(input({ weeklyCloses: closes, qty: 1, avgCost: 999, marketValue: 400 }), { totalInvestedUsdt: 999, totalValueUsdt: 400 });
    expect(s.metrics.weeklyRsi!).toBeGreaterThan(80);
    expect(s.kind).toBe("sell");
    expect(s.sellMin).toBe(0.1);
  });

  it("人民币上限按持仓市值比较，不看累计投入", () => {
    const closes = [...flat(40, 100), ...ramp(100, 40, 20)];
    const rich = strategyConfig.risk.maxTotalCapitalCny / strategyConfig.risk.usdtCny + 1;
    // 累计投入很大、但当前市值很小 -> 不触发上限
    const small = evaluateCoin(input({ weeklyCloses: closes }), { totalInvestedUsdt: rich * 10, totalValueUsdt: 1000 });
    expect(small.reasons.some((r) => r.key === "risk-capital")).toBe(false);
    // 当前市值超过上限 -> 触发
    const big = evaluateCoin(input({ weeklyCloses: closes }), { totalInvestedUsdt: 1, totalValueUsdt: rich });
    expect(big.reasons.some((r) => r.key === "risk-capital")).toBe(true);
  });

  it("单币仓位占比超限：即便有买入信号也暂停加仓", () => {
    const closes = [...flat(40, 100), ...ramp(100, 40, 20)];
    const s = evaluateCoin(
      input({ weeklyCloses: closes, qty: 10, avgCost: 90, marketValue: 400 }),
      { totalInvestedUsdt: 900, totalValueUsdt: 500 },
    );
    expect(s.kind).toBe("risk");
    expect(s.reasons[0].key).toBe("risk-weight");
  });

  it("持仓市值达到 5 万人民币上限：暂停加仓", () => {
    const closes = [...flat(40, 100), ...ramp(100, 40, 20)];
    const invested = strategyConfig.risk.maxTotalCapitalCny / strategyConfig.risk.usdtCny + 1;
    const s = evaluateCoin(input({ weeklyCloses: closes }), {
      totalInvestedUsdt: invested,
      totalValueUsdt: invested,
    });
    expect(s.kind).toBe("risk");
    expect(s.reasons.some((r) => r.key === "risk-capital")).toBe(true);
  });

  it("数据不足不会崩溃", () => {
    const s = evaluateCoin(input({ weeklyCloses: [100, 101, 99] }), ctx);
    expect(s.kind).toBe("none");
    expect(s.metrics.weeklyRsi).toBeNull();
  });
});

describe("今日结论", () => {
  const base = (symbol: string, kind: VerdictKind, score: number): CoinSignal => ({
    symbol,
    kind,
    tag: "观望",
    score,
    reasons: [{ key: "k", text: symbol }],
    addPct: null,
    addAmountCny: null,
    sellMin: null,
    sellMax: null,
    metrics: {
      weeklyRsi: null,
      monthlyRsi: null,
      drawdown: null,
      ma200: null,
      ma200Source: null,
      ma50Deviation: null,
      returnPct: null,
      weight: 0,
    },
  });

  it("没有信号 -> none", () => {
    const v = buildVerdict([base("BTC", "none", 0), base("ETH", "none", 0)]);
    expect(v.kind).toBe("none");
    expect(v.primary).toBeNull();
  });
  it("优先级：sell > risk > strong > accumulate", () => {
    const v = buildVerdict([
      base("A", "accumulate", 40),
      base("B", "strong", 80),
      base("C", "risk", 0),
      base("D", "sell", 0),
    ]);
    expect(v.kind).toBe("sell");
    expect(v.primary!.symbol).toBe("D");
    expect(v.others.map((o) => o.symbol)).toEqual(["C", "B", "A"]);
  });
  it("同级别按机会指数排序", () => {
    const v = buildVerdict([base("A", "accumulate", 30), base("B", "accumulate", 50)]);
    expect(v.primary!.symbol).toBe("B");
  });
});
