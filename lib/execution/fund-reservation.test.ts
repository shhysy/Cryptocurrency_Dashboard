import { describe, expect, it } from "vitest";
import { planBuyFundsReservation, remainingReservationAfterFill, reconcileBuyFundsReservation } from "./fund-reservation";
import type { BuyFundsReservation } from "./fund-reservation";

const active = (orderId: string, reservedUsdt: number): BuyFundsReservation => ({
  orderId, symbol: "BTCUSDT", reservedUsdt, originalReservedUsdt: reservedUsdt, consumedUsdt: 0, status: "active",
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
    })).toMatchObject({ ok: true, reserveUsdt: 30, availableUsdt: 80, totalReservedUsdt: 20 });
  });

  it("fails closed when an active reservation contains a non-finite amount", () => {
    const corrupted = { ...active("order-a", 20), reservedUsdt: Number.NaN };
    expect(planBuyFundsReservation({
      orderId: "order-b",
      requestedUsdt: 30,
      observedFreeUsdt: 100,
      activeReservations: [corrupted],
      minNotionalUsdt: 5,
    })).toMatchObject({ ok: false, reason: expect.stringContaining("损坏") });
  });

  it("fails closed when duplicate active reservations exist for one order", () => {
    expect(planBuyFundsReservation({
      orderId: "order-b",
      requestedUsdt: 30,
      observedFreeUsdt: 100,
      activeReservations: [active("order-a", 20), active("order-a", 10)],
      minNotionalUsdt: 5,
    })).toMatchObject({ ok: false, reason: expect.stringContaining("重复") });
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

  it("reconciles cumulative confirmed spend idempotently and rejects overspend", () => {
    const reservation = { ...active("order-a", 30), originalReservedUsdt: 50, consumedUsdt: 20 };
    expect(remainingReservationAfterFill(reservation, 20)).toBe(30);
    expect(remainingReservationAfterFill(reservation, 35)).toBe(15);
    expect(() => remainingReservationAfterFill(reservation, 51)).toThrow("超过资金预留");
  });
});


describe("monotonic buy reservation reconciliation", () => {
  it("reduces the reservation from cumulative confirmed spend", () => {
    const first = reconcileBuyFundsReservation(active("order-a", 50), 20, false, 10);
    expect(first).toMatchObject({ reservedUsdt: 30, consumedUsdt: 20, status: "active" });
    const second = reconcileBuyFundsReservation(first, 35, false, 20);
    expect(second).toMatchObject({ reservedUsdt: 15, consumedUsdt: 35, status: "active" });
  });

  it("rejects an older concurrent-tab snapshot instead of restoring reserved funds", () => {
    const newer = reconcileBuyFundsReservation(active("order-a", 50), 30, false, 20);
    expect(() => reconcileBuyFundsReservation(newer, 20, false, 30)).toThrow("较旧的成交快照");
    expect(newer.reservedUsdt).toBe(20);
  });

  it("keeps a zero-remaining reservation active while the exchange order is still open", () => {
    const updated = reconcileBuyFundsReservation(active("order-a", 50), 50, false, 20);
    expect(updated).toMatchObject({ reservedUsdt: 0, consumedUsdt: 50, status: "active" });
  });

  it("releases only on a terminal snapshot and refuses later non-terminal reactivation", () => {
    const released = reconcileBuyFundsReservation(active("order-a", 50), 20, true, 20);
    expect(released).toMatchObject({ reservedUsdt: 0, status: "released" });
    expect(() => reconcileBuyFundsReservation(released, 20, false, 30)).toThrow("非终态快照重新激活");
  });

  it("rejects a corrupted persisted reservation before reconciling it", () => {
    const corrupted = { ...active("order-a", 50), reservedUsdt: Number.NaN };
    expect(() => reconcileBuyFundsReservation(corrupted, 10, false, 20))
      .toThrow("记录损坏");
  });

  it("rejects a changed cumulative fill total after reservation release", () => {
    const released = reconcileBuyFundsReservation(active("order-a", 50), 0, true, 20);
    expect(() => reconcileBuyFundsReservation(released, 5, true, 30))
      .toThrow("释放后成交累计值发生变化");
  });

  it("allows an idempotent terminal refresh", () => {
    const released = reconcileBuyFundsReservation(active("order-a", 50), 20, true, 20);
    expect(reconcileBuyFundsReservation(released, 20, true, 30))
      .toMatchObject({ reservedUsdt: 0, consumedUsdt: 20, status: "released" });
  });
});
