import { describe, expect, it } from "vitest";
import {
  calculateLimitNotional,
  calculateLimitOrderPrice,
  floorQuantityToStep,
  quoteBudgetToBaseQuantity,
} from "./limit-order";

describe("LIMIT GTC 十进制定点计算", () => {
  it("BUY按参考价上浮0.5%并按tickSize向下取整", () => {
    expect(calculateLimitOrderPrice({
      side: "BUY", referencePrice: "100000", tickSize: "0.1",
    })).toBe("100500");
    expect(calculateLimitOrderPrice({
      side: "BUY", referencePrice: "100.03", tickSize: "0.1",
    })).toBe("100.5");
  });

  it("SELL按参考价下浮0.5%并按tickSize向上取整", () => {
    expect(calculateLimitOrderPrice({
      side: "SELL", referencePrice: "100000", tickSize: "0.1",
    })).toBe("99500");
    expect(calculateLimitOrderPrice({
      side: "SELL", referencePrice: "100.03", tickSize: "0.1",
    })).toBe("99.6");
  });

  it("BUY预算换算基础币数量并按stepSize向下取整", () => {
    const qty = quoteBudgetToBaseQuantity("100", "100500", "0.00001");
    expect(qty).toBe("0.00099");
    expect(calculateLimitNotional("100500", qty)).toBe("99.495");
  });

  it("数量向下取整，不会超过原数量", () => {
    expect(floorQuantityToStep("0.123456", "0.001")).toBe("0.123");
  });

  it("拒绝零值、非法格式和非正tickSize", () => {
    expect(() => calculateLimitOrderPrice({
      side: "BUY", referencePrice: "0", tickSize: "0.01",
    })).toThrow();
    expect(() => calculateLimitOrderPrice({
      side: "SELL", referencePrice: "100", tickSize: "0",
    })).toThrow();
    expect(() => floorQuantityToStep("1e-8", "0.000001")).toThrow();
  });
});
