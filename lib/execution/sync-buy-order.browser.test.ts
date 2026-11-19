import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchSpotOrderByClientId: vi.fn(),
  fetchSpotTradesForOrder: vi.fn(),
  listBuyOrders: vi.fn(),
  markBuyOrderReconcileRequired: vi.fn(),
  markBuyOrderReconciled: vi.fn(),
  recordConfirmedBuyFill: vi.fn(),
  applyConfirmedBuyReservationSpend: vi.fn(),
  releaseBuyFundsReservation: vi.fn(),
}));

vi.mock("../binance.browser", () => ({
  fetchSpotOrderByClientId: mocks.fetchSpotOrderByClientId,
  fetchSpotTradesForOrder: mocks.fetchSpotTradesForOrder,
}));
vi.mock("./store.browser", () => ({
  listBuyOrders: mocks.listBuyOrders,
  markBuyOrderReconcileRequired: mocks.markBuyOrderReconcileRequired,
  markBuyOrderReconciled: mocks.markBuyOrderReconciled,
  recordConfirmedBuyFill: mocks.recordConfirmedBuyFill,
  applyConfirmedBuyReservationSpend: mocks.applyConfirmedBuyReservationSpend,
  releaseBuyFundsReservation: mocks.releaseBuyFundsReservation,
}));

import { syncBuyOrderFromBinance } from "./sync-buy-order.browser";
import { clientOrderIdForEvent } from "./client-order-id";

const order = {
  id: "buy-1", eventKey: "BTC:add:week-1", symbol: "BTC", quoteAsset: "USDT",
  strategyLabel: "补仓1", plannedUsdt: 200, referencePrice: 50000,
  baseRatioAtSignal: 0.4, createdAt: 1, updatedAt: 1,
  status: "reconcile_required" as const, filledUsdt: 0, remainingUsdt: 200,
  attemptCount: 1, lastAttemptAt: 2, lastError: null, strategyVersion: "V3.3" as const,
};

const snapshot = {
  symbol: "BTCUSDT", clientOrderId: "unused", orderId: 55, status: "PARTIALLY_FILLED" as const,
  origQty: "0.004", executedQty: "0.002", cummulativeQuoteQty: "100",
};

const trade = {
  id: 1, orderId: 55, symbol: "BTCUSDT", price: 50000, qty: 0.002,
  quoteQty: 100, commission: 0, commissionAsset: "USDT", time: 1000, isBuyer: true,
};

describe("buy reconciliation stale-attempt protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listBuyOrders.mockResolvedValue([order]);
    mocks.fetchSpotOrderByClientId.mockResolvedValue({
      ...snapshot,
      clientOrderId: clientOrderIdForEvent(order.eventKey, 0),
    });
    mocks.fetchSpotTradesForOrder.mockResolvedValue([trade]);
    mocks.markBuyOrderReconcileRequired.mockResolvedValue(order);
    mocks.recordConfirmedBuyFill.mockResolvedValue({
      recorded: true,
      ledger: {},
      order,
    });
    mocks.applyConfirmedBuyReservationSpend.mockResolvedValue(null);
  });

  it("keeps a partial order locked and tags the state write with its attempt", async () => {
    const result = await syncBuyOrderFromBinance(order.id, 0);
    expect(result.action).toBe("partial");
    expect(mocks.markBuyOrderReconcileRequired).toHaveBeenCalledWith(
      order.id,
      expect.stringContaining("PARTIALLY_FILLED"),
      0,
    );
  });

  it("tags a fill-write failure with its attempt so an old tab cannot relock a newer attempt", async () => {
    mocks.recordConfirmedBuyFill.mockRejectedValue(new Error("simulated ledger failure"));
    const result = await syncBuyOrderFromBinance(order.id, 0);
    expect(result.action).toBe("manual_review");
    expect(mocks.markBuyOrderReconcileRequired).toHaveBeenCalledWith(
      order.id, "simulated ledger failure", 0,
    );
  });

  it("passes the originating attempt into the reservation transaction", async () => {
    await syncBuyOrderFromBinance(order.id, 0);
    expect(mocks.applyConfirmedBuyReservationSpend).toHaveBeenCalledWith(
      order.id, 100, false, 0,
    );
  });

  it("tags reservation reconciliation failures with the same attempt", async () => {
    mocks.applyConfirmedBuyReservationSpend.mockRejectedValue(new Error("simulated reservation conflict"));
    const result = await syncBuyOrderFromBinance(order.id, 0);
    expect(result.action).toBe("manual_review");
    expect(mocks.markBuyOrderReconcileRequired).toHaveBeenCalledWith(
      order.id, "simulated reservation conflict", 0,
    );
  });
});
