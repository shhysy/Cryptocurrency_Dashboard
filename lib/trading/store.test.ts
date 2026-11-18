import { describe, expect, it } from "vitest";
import { queuedOrdersToCsv } from "./store";

describe("queued order CSV export", () => {
  it("exports UTF-8 BOM and the requested Chinese filename's data schema", () => {
    const csv = queuedOrdersToCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("订单ID");
    expect(csv).toContain("剩余金额USDT");
  });

  it("quotes cells and neutralizes spreadsheet formulas", () => {
    const csv = queuedOrdersToCsv([{
      id: "=HYPERLINK(1)",
      eventKey: "event-1",
      symbol: "BTCUSDT",
      side: "BUY",
      strategyTag: "头仓",
      plannedQuoteUsdt: 100,
      filledQuoteUsdt: 50,
      remainingQuoteUsdt: 50,
      status: "partially-filled",
      createdAt: 0,
      updatedAt: 1,
    }]);
    expect(csv).toContain(""'=HYPERLINK(1)"");
    expect(csv).toContain(""50"");
  });
});
