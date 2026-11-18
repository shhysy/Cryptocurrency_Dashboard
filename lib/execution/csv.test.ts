import { describe, expect, it } from "vitest";
import { queuedOrdersToCsv } from "./csv";
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
