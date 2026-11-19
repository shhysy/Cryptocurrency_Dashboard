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

export interface ReservationTopUpPlan {
  ok: boolean;
  reservedUsdt: number;
  additionalUsdt: number;
  availableUsdt: number;
  totalReservedUsdt: number;
  reason: string | null;
}

/** Validate the live queue row before creating or extending its local reservation. */
export function buyOrderReservationBlockReason(
  order: {
    id: string;
    symbol: string;
    quoteAsset: string;
    status: string;
  } | null | undefined,
  orderId: string,
  reservationSymbol: string,
): string | null {
  if (!order || order.id !== orderId) return "资金预留对应的待买订单不存在";
  if (order.status !== "pending" && order.status !== "partially_filled") {
    return `待买订单当前状态为 ${order.status}，禁止新建或扩展资金预留`;
  }
  if (!order.symbol || !order.quoteAsset) return "待买订单缺少交易对信息";
  const pair = order.symbol.endsWith(order.quoteAsset)
    ? order.symbol
    : order.symbol + order.quoteAsset;
  if (pair !== reservationSymbol) return "资金预留交易对与当前待买订单不一致";
  return null;
}

/**
 * Extend an existing order reservation without ever shrinking funds already
 * held for that order. Only the unreserved balance after other orders may fund
 * the additional amount.
 */
export function planBuyFundsReservationTopUp(input: {
  orderId: string;
  requestedRemainingUsdt: number;
  observedFreeUsdt: number;
  activeReservations: BuyFundsReservation[];
  currentReservation: BuyFundsReservation | null;
}): ReservationTopUpPlan {
  const { orderId, requestedRemainingUsdt, observedFreeUsdt, activeReservations, currentReservation } = input;
  if (!orderId || !Array.isArray(activeReservations) ||
      !Number.isFinite(requestedRemainingUsdt) || requestedRemainingUsdt < 0 ||
      !Number.isFinite(observedFreeUsdt) || observedFreeUsdt < 0) {
    return {
      ok: false, reservedUsdt: 0, additionalUsdt: 0, availableUsdt: 0,
      totalReservedUsdt: 0, reason: "理财到账后的资金预留参数无效",
    };
  }
  if (currentReservation && currentReservation.orderId !== orderId) {
    return {
      ok: false, reservedUsdt: 0, additionalUsdt: 0, availableUsdt: 0,
      totalReservedUsdt: 0, reason: "当前资金预留订单 ID 不匹配",
    };
  }
  if (currentReservation && !["active", "released"].includes(currentReservation.status)) {
    return {
      ok: false, reservedUsdt: 0, additionalUsdt: 0, availableUsdt: 0,
      totalReservedUsdt: 0, reason: "当前资金预留状态无效，必须人工核对",
    };
  }
  if (currentReservation) {
    const original = currentReservation.originalReservedUsdt ?? currentReservation.reservedUsdt;
    const consumed = currentReservation.consumedUsdt ?? 0;
    if (!currentReservation.symbol ||
        ![currentReservation.reservedUsdt, original, consumed].every(Number.isFinite) ||
        currentReservation.reservedUsdt < 0 || original <= 0 || consumed < 0 ||
        consumed > original + 1e-8 ||
        currentReservation.reservedUsdt > original - consumed + 1e-8 ||
        (currentReservation.status === "released" && currentReservation.reservedUsdt > 1e-8)) {
      return {
        ok: false, reservedUsdt: 0, additionalUsdt: 0, availableUsdt: 0,
        totalReservedUsdt: 0, reason: "当前资金预留记录损坏，必须人工核对",
      };
    }
  }

  const active = activeReservations.filter((item) => item?.status === "active");
  const validation = planBuyFundsReservation({
    orderId,
    requestedUsdt: Math.max(requestedRemainingUsdt, 1e-8),
    observedFreeUsdt,
    activeReservations,
    minNotionalUsdt: 0,
  });
  if (!validation.ok) {
    return {
      ok: false, reservedUsdt: 0, additionalUsdt: 0,
      availableUsdt: validation.availableUsdt,
      totalReservedUsdt: validation.totalReservedUsdt,
      reason: validation.reason,
    };
  }
  const existingActive = active.find((item) => item.orderId === orderId) ?? null;
  if (existingActive && (!currentReservation || existingActive !== currentReservation)) {
    return {
      ok: false, reservedUsdt: 0, additionalUsdt: 0,
      availableUsdt: validation.availableUsdt,
      totalReservedUsdt: validation.totalReservedUsdt,
      reason: "当前活动资金预留快照不一致，必须人工核对",
    };
  }

  const currentReserved = existingActive?.reservedUsdt ?? 0;
  if (currentReserved > validation.availableUsdt + 1e-8) {
    return {
      ok: false, reservedUsdt: currentReserved, additionalUsdt: 0,
      availableUsdt: validation.availableUsdt,
      totalReservedUsdt: validation.totalReservedUsdt + currentReserved,
      reason: "当前交易所可用余额低于已有本地资金预留总额，停止扩展并要求人工核对",
    };
  }
  const desiredAdditional = Math.max(0, requestedRemainingUsdt - currentReserved);
  const additionalCapacity = Math.max(0, validation.availableUsdt - currentReserved);
  const additionalUsdt = Math.min(desiredAdditional, additionalCapacity);
  const reservedUsdt = currentReserved + additionalUsdt;
  return {
    ok: true,
    reservedUsdt,
    additionalUsdt,
    availableUsdt: validation.availableUsdt,
    totalReservedUsdt: validation.totalReservedUsdt + reservedUsdt,
    reason: null,
  };
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

  // Never ignore malformed rows: an unknown status or damaged released row
  // could otherwise hide funds from the shared allocation calculation.
  const active = activeReservations.filter((item) => item?.status === "active");
  const seenOrderIds = new Set<string>();
  for (const item of activeReservations) {
    const original = item?.originalReservedUsdt ?? item?.reservedUsdt;
    const consumed = item?.consumedUsdt ?? 0;
    if (!item?.orderId || !item.symbol || seenOrderIds.has(item.orderId) ||
        (item.status !== "active" && item.status !== "released") ||
        ![item.reservedUsdt, original, consumed].every(Number.isFinite) ||
        item.reservedUsdt < 0 || original <= 0 || consumed < 0 ||
        consumed > original + 1e-8 ||
        item.reservedUsdt > original - consumed + 1e-8 ||
        (item.status === "released" && item.reservedUsdt > 1e-8)) {
      return {
        ok: false, reserveUsdt: 0, availableUsdt: 0,
        totalReservedUsdt: 0, reason: "检测到损坏、未知状态或重复的资金预留记录，已停止分配并要求人工核对",
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
  if (reservation.status === "released" &&
      Math.abs(cumulativeConfirmedSpendUsdt - consumed) > 1e-8) {
    throw new Error("资金预留释放后成交累计值发生变化，必须人工复核");
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
