import { describe, expect, it } from "vitest";
import { mergeEarnBalances } from "./binance";

const row = (asset: string, free: string, locked = "0") => ({ asset, free, locked });

describe("现货余额资产代码保留", () => {
  it("不会把 LDUSDT / LDUNI 猜测合并到普通资产", () => {
    const result = mergeEarnBalances([
      row("LDUNI", "0.75"),
      row("LDUSDT", "0.97"),
      row("USDT", "10"),
    ]);
    expect(result.LDUNI).toBeCloseTo(0.75, 9);
    expect(result.LDUSDT).toBeCloseTo(0.97, 9);
    expect(result.USDT).toBe(10);
    expect(result.UNI).toBeUndefined();
  });

  it("现货同一资产的 free 和 locked 正确相加", () => {
    const result = mergeEarnBalances([
      row("USDT", "10", "2"),
      row("BTC", "0.1", "0.02"),
    ]);
    expect(result.USDT).toBe(12);
    expect(result.BTC).toBeCloseTo(0.12, 10);
  });

  it("真实币种 LDO 不会被改名", () => {
    const result = mergeEarnBalances([
      row("LDO", "1"),
      row("LDLDO", "2"),
      row("BTC", "3"),
    ]);
    expect(result.LDO).toBe(1);
    expect(result.LDLDO).toBe(2);
    expect(result.BTC).toBe(3);
  });

  it("拒绝无效或负数余额", () => {
    expect(() => mergeEarnBalances([row("USDT", "NaN")])).toThrow("余额无效");
    expect(() => mergeEarnBalances([row("USDT", "-1")])).toThrow("余额无效");
  });
});
