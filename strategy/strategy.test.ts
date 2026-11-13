import { describe, expect, it } from "vitest";
import { computeCost, mergeTrades } from "./cost";
import { rsi, sma } from "./indicators";
import type { Trade } from "./types";

const ramp = (from: number, to: number, n: number) =>
  Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 1)) / n);

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

