export interface BuyFundsReservation {
  orderId: string;
  symbol: string;
  reservedUsdt: number;
  originalReservedUsdt: number;
  consumedUsdt: number;
  status: "active" | "released";
  createdAt: number;
  updatedAt: number;
  releaseReason: string | null;
}

export interface ReservationPlan {
  ok: boolean;
  reserveUsdt: number;
  availableUsdt: number;
  totalReservedUsdt: number;
  reason: string | null;
}

/**
 * Calculate a reservation against a fresh Binance USDT free snapshot.
 * Active reservations from other queue orders are deducted first.
 */
export function planBuyFundsReservation(input: {
  orderId: string;
  requestedUsdt: number;
  observedFreeUsdt: number;
  activeReservations: BuyFundsReservation[];
  minNotionalUsdt: number;
}): ReservationPlan {
  const { orderId, requestedUsdt, observedFreeUsdt, activeReservations, minNotionalUsdt } = input;
  if (!orderId || ![requestedUsdt, observedFreeUsdt, minNotionalUsdt].every(Number.isFinite)
    || requestedUsdt <= 0 || observedFreeUsdt < 0 || minNotionalUsdt < 0) {
    return {
      ok: false, reserveUsdt: 0, availableUsdt: 0,
      totalReservedUsdt: 0, reason: "资金预留参数无效",
    };
  }

  const existing = activeReservations.find(
    (item) => item.status === "active" && item.orderId === orderId,
  );
  const totalReservedUsdt = activeReservations
    .filter((item) => item.status === "active" && item.orderId !== orderId)
    .reduce((sum, item) => sum + Math.max(0, item.reservedUsdt), 0);
  const availableUsdt = Math.max(0, observedFreeUsdt - totalReservedUsdt);
  // An existing reservation is reused as-is; this function never silently
  // increases it on a repeated preview.
  const reserveUsdt = existing
    ? existing.reservedUsdt
    : Math.min(requestedUsdt, availableUsdt);

  if (reserveUsdt + 1e-8 < minNotionalUsdt) {
    return {
      ok: false, reserveUsdt: 0, availableUsdt, totalReservedUsdt,
      reason: availableUsdt <= 1e-8
        ? "USDT 可用余额已被其他待执行订单预留"
        : "扣除其他订单资金预留后，金额低于交易所最小名义金额",
    };
  }

  return {
    ok: true,
    reserveUsdt,
    availableUsdt,
    totalReservedUsdt,
    reason: null,
  };
}

/** Confirmed quote spend (including USDT-equivalent commission) consumes the reservation. */
export function remainingReservationAfterFill(
  reservation: BuyFundsReservation,
  confirmedSpendUsdt: number,
): number {
  if (!Number.isFinite(confirmedSpendUsdt) || confirmedSpendUsdt < 0) {
    throw new Error("已确认成交支出无效");
  }
  const original = reservation.originalReservedUsdt ?? reservation.reservedUsdt;
  if (confirmedSpendUsdt > original + 1e-8) {
    throw new Error("累计成交支出超过资金预留，必须人工复核");
  }
  return Math.max(0, original - confirmedSpendUsdt);
}
