import { describe, expect, it } from "vitest";
import { watchlist } from "@/watchlist.config";
import { buildDashboard, type RawData } from "./dashboard";
import type { Candle } from "@/strategy/types";

const W = 7 * 864e5;
const wk = (p: number): Candle[] => Array.from({ length: 60 }, (_, i) => ({ t: i * W, o: p, h: p, l: p, c: p, v: 1 }));
const symbols = watchlist.map((w) => w.symbol);

function raw(balances: Record<string, number>, extra: RawData["extraAssets"]): RawData {
  return {
    tickers: Object.fromEntries(symbols.map((s) => [s, { price: 10, change24h: 0 }])),
    weekly: Object.fromEntries(symbols.map((s) => [s, wk(10)])),
    monthly: Object.fromEntries(symbols.map((s) => [s, wk(10)])),
    trades: [],
    balances,
    extraAssets: extra,
  };
}
const meta = { source: "binance" as const, updatedAt: 0 };

describe("小额余额过滤（< 0.5 USDT 不计入）", () => {
  it("持仓折合 0.49 USDT 不计入，0.5 USDT 起计入", () => {
    const d = buildDashboard(raw({ UNI: 0.049, LINK: 0.05 }, []), meta);
    const uni = d.coins.find((c) => c.symbol === "UNI")!;
    const link = d.coins.find((c) => c.symbol === "LINK")!;
    expect(uni.qty).toBe(0);
    expect(link.qty).toBe(0.05);
    expect(d.summary.totalValue).toBeCloseTo(0.5, 9);
  });

  it("账户余额列表剔除不足 0.5 USDT 和查不到价格的项，现金同样过滤", () => {
    const d = buildDashboard(
      raw({}, [
        { asset: "USDT", qty: 1.1, usdt: 1.1 },
 { asset: "USDC", qty: 0.3, usdt: 0.3 },
        { asset: "LDADA", qty: 0.006, usdt: null },
        { asset: "UNI", qty: 0.76, usdt: 4.7 },
      ]),
      meta,
    );
    expect(d.account.cashUsdt).toBeCloseTo(1.1, 9);
    expect(d.account.assets.map((a) => a.asset)).toEqual(["USDT", "UNI"]);
  });
});
