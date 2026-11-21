import { describe, expect, it } from "vitest";
import { queuedOrdersToCsv, tradeLedgerToCsv } from "./csv";
import type { QueuedBuyOrder } from "./types";

const order: QueuedBuyOrder = {
  id: "order-1",
  eventKey: "=HYPERLINK(1)",
  symbol: "BTC",
  quoteAsset: "USDT",
  strategyLabel: "+cmd",
  plannedUsdt: 100,
  referencePrice: 50000,
  baseRatioAtSignal: 0.4,
  createdAt: 1,
  strategyVersion: "V3.3",
  status: "pending",
  filledUsdt: 0,
  remainingUsdt: 100,
  attemptCount: 0,
  lastAttemptAt: null,
  lastError: "-danger",
  updatedAt: 2,
};

describe("待买队列 CSV", () => {
  it("exports expected queue fields", () => {
    const csv = queuedOrdersToCsv([order]);
    expect(csv).toContain("eventKey");
    expect(csv).toContain("remainingUsdt");
    expect(csv).toContain("BTC");
  });

  it("neutralizes formula-like text cells", () => {
    const csv = queuedOrdersToCsv([order]);
    expect(csv).toContain(`"'=HYPERLINK(1)"`);
    expect(csv).toContain(`"'+cmd"`);
    expect(csv).toContain(`"'-danger"`);
  });
});


describe("真实成交台账 CSV", () => {
  it("导出真实逐笔成交，保留负数盈亏并防止文本公式注入", () => {
    const csv = tradeLedgerToCsv([{
      id: "ledger-1", fillId: "trade-100", orderId: "order-200", symbol: "BTCUSDT",
      side: "SELL", time: 1000, price: 99000, qty: 0.001, quoteQty: 99,
      commission: 0.01, commissionAsset: "USDT", commissionUsdt: 0.01,
      realizedPnlUsdt: -2.5, sellKind: "take_profit",
    }]);
    expect(csv).toContain("trade-100");
    expect(csv).toContain('" -2.5"'.replace(' ', ''));
    expect(csv).toContain("BTCUSDT");
    expect(csv).not.toContain("referencePrice");
  });
});
