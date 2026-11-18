import { describe, expect, it } from "vitest";
import { planBuyFundsReservation, remainingReservationAfterFill } from "./fund-reservation";
import type { BuyFundsReservation } from "./fund-reservation";

const active = (orderId: string, reservedUsdt: number): BuyFundsReservation => ({
  orderId, symbol: "BTCUSDT", reservedUsdt, status: "active",
  createdAt: 1, updatedAt: 1, releaseReason: null,
});

describe("USDT buy-funds reservation planner", () => {
  it("deducts other active queue reservations from fresh USDT free", () => {
    expect(planBuyFundsReservation({
      orderId: "order-b",
      requestedUsdt: 80,
      observedFreeUsdt: 100,
      activeReservations: [active("order-a", 60)],
      minNotionalUsdt: 5,
    })).toMatchObject({ ok: true, reserveUsdt: 40, availableUsdt: 40, totalReservedUsdt: 60 });
  });

  it("allows partial reservation when the remaining unreserved balance is sufficient", () => {
    expect(planBuyFundsReservation({
      orderId: "order-b",
      requestedUsdt: 100,
      observedFreeUsdt: 50,
      activeReservations: [],
      minNotionalUsdt: 5,
    })).toMatchObject({ ok: true, reserveUsdt: 50 });
  });

  it("does not count the same order reservation twice", () => {
    expect(planBuyFundsReservation({
      orderId: "order-a",
      requestedUsdt: 80,
      observedFreeUsdt: 100,
      activeReservations: [active("order-a", 30), active("order-b", 20)],
      minNotionalUsdt: 5,
    })).toMatchObject({ ok: true, reserveUsdt: 80, totalReservedUsdt: 20 });
  });

  it("blocks when unreserved funds fall below exchange minimum notional", () => {
    expect(planBuyFundsReservation({
      orderId: "order-b",
      requestedUsdt: 50,
      observedFreeUsdt: 10,
      activeReservations: [active("order-a", 7)],
      minNotionalUsdt: 5,
    })).toMatchObject({ ok: false, reserveUsdt: 0, availableUsdt: 3 });
  });

  it("consumes only confirmed fill spend and rejects overspend", () => {
    expect(remainingReservationAfterFill(active("order-a", 50), 20)).toBe(30);
    expect(() => remainingReservationAfterFill(active("order-a", 50), 51)).toThrow("超过资金预留");
  });
});
