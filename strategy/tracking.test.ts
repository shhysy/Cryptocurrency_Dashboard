import { describe, expect, it } from "vitest";
import { computeCost } from "./cost";
import { applyTrackingStart } from "./tracking";
import type { Candle, Trade } from "./types";

const D = (s: string) => Date.parse(`${s}T00:00:00Z`);
const trade = (symbol: string, day: string, price: number, qty: number, source: Trade["source"] = "binance"): Trade => ({
  id: `${symbol}-${day}-${price}-${qty}`,
  symbol,
  time: D(day),
  price,
  qty,
  fee: 0,
  source,
});
const weekly = (open: number): Candle[] => [{ t: D("2026-11-09"), o: open, h: open, l: open, c: open, v: 1 }];
const base = { start: D("2026-11-12"), weekly: { UNI: weekly(6) }, prices: { UNI: 6.15 }, symbols: ["UNI"] };

describe("收益起算日", () => {
  it("历史上买了又卖掉的交易不再计入成本（修复总投入虚高）", () => {
    // 历史：买 100 个 @10，卖 99.2358 个，只剩 0.7642 个
    const history = [trade("UNI", "2025-03-01", 10, 100), trade("UNI", "2025-05-01", 12, 1)];
    const r = applyTrackingStart({ ...base, trades: history, balances: { UNI: 0.76432703 } });
    const cost = computeCost(r.trades);
    expect(cost.invested).toBeCloseTo(0.76432703 * 6, 6);
    expect(cost.avgCost).toBeCloseTo(6, 6);
    expect(r.synthetic).toEqual(["UNI"]);
  });

  it("起算日之后的买入照常计入，只补差额", () => {
    const t = [trade("UNI", "2026-11-13", 7, 2)];
    const r = applyTrackingStart({ ...base, trades: t, balances: { UNI: 5 } });
    const qty = r.trades.reduce((s, x) => s + x.qty, 0);
    expect(qty).toBeCloseTo(5, 9);
    expect(r.trades.filter((x) => x.id.startsWith("opening"))[0].qty).toBeCloseTo(3, 9);
  });

  it("用户手动写了起算日之前的真实成本：保留，不再合成期初", () => {
    const t = [trade("UNI", "2026-01-05", 4.5, 0.76, "manual")];
    const r = applyTrackingStart({ ...base, trades: t, balances: { UNI: 0.764 } });
    expect(r.synthetic).toEqual([]);
    expect(computeCost(r.trades).avgCost).toBeCloseTo(4.5, 9);
  });

  it("持仓数量与记录相差 1% 以内视为取整误差，不补", () => {
    const t = [trade("UNI", "2026-11-13", 7, 10)];
    const r = applyTrackingStart({ ...base, trades: t, balances: { UNI: 10.05 } });
    expect(r.synthetic).toEqual([]);
  });

  it("没有持仓时不合成任何记录", () => {
    const r = applyTrackingStart({ ...base, trades: [trade("UNI", "2025-03-01", 10, 5)], balances: { UNI: 0 } });
    expect(r.trades).toHaveLength(0);
  });

  it("拿不到周线时退回当前价", () => {
    const r = applyTrackingStart({ ...base, weekly: {}, trades: [], balances: { UNI: 2 } });
    expect(r.trades[0].price).toBe(6.15);
  });
});
