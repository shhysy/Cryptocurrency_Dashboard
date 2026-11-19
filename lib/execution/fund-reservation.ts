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
  if (!orderId || !Array.isArray(activeReservations) ||
      ![requestedUsdt, observedFreeUsdt, minNotionalUsdt].every(Number.isFinite) ||
      requestedUsdt <= 0 || observedFreeUsdt < 0 || minNotionalUsdt < 0) {
    return {
      ok: false, reserveUsdt: 0, availableUsdt: 0,
      totalReservedUsdt: 0, reason: "资金预留参数无效",
    };
  }

  // Corrupt local reservation rows must never be ignored while allocating a
  // shared balance snapshot. One bad active row blocks the entire allocation.
  const active = activeReservations.filter((item) => item?.status === "active");
  const seenOrderIds = new Set<string>();
  for (const item of active) {
    const original = item.originalReservedUsdt ?? item.reservedUsdt;
    const consumed = item.consumedUsdt ?? 0;
    if (!item.orderId || seenOrderIds.has(item.orderId) ||
        ![item.reservedUsdt, original, consumed].every(Number.isFinite) ||
        item.reservedUsdt < 0 || original <= 0 || consumed < 0 ||
        consumed > original + 1e-8 ||
        item.reservedUsdt > original - consumed + 1e-8) {
      return {
        ok: false, reserveUsdt: 0, availableUsdt: 0,
        totalReservedUsdt: 0, reason: "检测到损坏或重复的活动资金预留记录，已停止分配并要求人工核对",
      };
    }
    seenOrderIds.add(item.orderId);
  }

  const existing = active.find((item) => item.orderId === orderId);
  const totalReservedUsdt = active
    .filter((item) => item.orderId !== orderId)
    .reduce((sum, item) => sum + item.reservedUsdt, 0);
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


/**
 * Apply a monotonic cumulative-spend snapshot. Concurrent tabs may finish
 * reconciliation out of order, so an older snapshot must never restore funds.
 * A non-terminal snapshot also cannot reopen a reservation already released
 * after a confirmed terminal exchange status.
 */
export function reconcileBuyFundsReservation(
  reservation: BuyFundsReservation,
  cumulativeConfirmedSpendUsdt: number,
  exchangeOrderTerminal: boolean,
  now = Date.now(),
): BuyFundsReservation {
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new Error("资金预留更新时间无效");
  }
  const original = reservation.originalReservedUsdt ?? reservation.reservedUsdt;
  const consumed = reservation.consumedUsdt ?? 0;
  if (!reservation.orderId || !["active", "released"].includes(reservation.status) ||
      ![reservation.reservedUsdt, original, consumed].every(Number.isFinite) ||
      reservation.reservedUsdt < 0 || original <= 0 || consumed < 0 ||
      consumed > original + 1e-8 || reservation.reservedUsdt > original - consumed + 1e-8) {
    throw new Error("现有资金预留记录损坏，必须人工复核");
  }
  if (!Number.isFinite(cumulativeConfirmedSpendUsdt) || cumulativeConfirmedSpendUsdt < 0) {
    throw new Error("累计成交支出无效");
  }
  if (cumulativeConfirmedSpendUsdt + 1e-8 < consumed) {
    throw new Error("收到较旧的成交快照，拒绝回退已确认支出和资金预留");
  }
  if (reservation.status === "released" && !exchangeOrderTerminal) {
    throw new Error("资金预留已因订单终态释放，拒绝被非终态快照重新激活");
  }
  const remaining = remainingReservationAfterFill(reservation, cumulativeConfirmedSpendUsdt);
  return {
    ...reservation,
    reservedUsdt: exchangeOrderTerminal ? 0 : remaining,
    originalReservedUsdt: reservation.originalReservedUsdt ?? reservation.reservedUsdt,
    consumedUsdt: cumulativeConfirmedSpendUsdt,
    status: exchangeOrderTerminal ? "released" : "active",
    updatedAt: now,
    releaseReason: exchangeOrderTerminal ? "Binance 已确认订单进入终态" : null,
  };
}
