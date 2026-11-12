import { describe, expect, it } from "vitest";
import { mergeEarnBalances } from "./binance";

const row = (asset: string, free: string, locked = "0") => ({ asset, free, locked });

describe("理财凭证合并", () => {
  it("LDUNI 合并进 UNI，LDUSDT 合并进 USDT", () => {
    const r = mergeEarnBalances([row("LDUNI", "0.75972417"), row("LDUSDT", "0.97572618")]);
    expect(r.UNI).toBeCloseTo(0.75972417, 9);
    expect(r.USDT).toBeCloseTo(0.97572618, 9);
    expect(r.LDUNI).toBeUndefined();
  });

  it("现货和理财里的同一个币相加，冻结部分也计入", () => {
    const r = mergeEarnBalances([row("UNI", "1", "0.5"), row("LDUNI", "2")]);
    expect(r.UNI).toBeCloseTo(3.5, 9);
  });

  it("真实币种 LDO 不会被误改；它的理财凭证 LDLDO 会还原成 LDO", () => {
    const r = mergeEarnBalances([row("LDO", "1"), row("LDLDO", "2"), row("BTC", "3")]);
    expect(r.LDO).toBe(3);
    expect(r.LDLDO).toBeUndefined();
    expect(r.BTC).toBe(3);
  });
});
