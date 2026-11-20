/**
 * 卖出订单：交易所状态 → 本地事件状态映射（纯函数，无 IO）。
 * 策略：非终态订单不得标记为可续卖的 partially_filled；
 * 仅 FILLED / CANCELED / EXPIRED / REJECTED 才进入终态分支。
 */

export type LocalSellStatusAfterSync =
  | "executed"
  | "partially_filled"
  | "reconcile_required";

/** 币安现货订单是否已进入终态（不会再有新成交） */
export function isExchangeSpotOrderTerminal(exchangeStatus: string): boolean {
  const status = String(exchangeStatus || "").toUpperCase();
  return status === "FILLED" || status === "CANCELED" || status === "EXPIRED" || status === "REJECTED";
}

/**
 * 在成交明细已与订单累计核对一致之后，决定本地事件状态。
 * - 非终态（NEW / PARTIALLY_FILLED / PENDING_CANCEL 等）→ reconcile_required（继续只读对账，禁止 resume）
 * - 终态且卖满 → executed
 * - 终态但未卖满 → partially_filled（允许在对账字段齐全时 resume 剩余）
 */
export function localSellStatusAfterReconciledSnapshot(input: {
  exchangeStatus: string;
  executedQty: number;
  origQty: number;
}): LocalSellStatusAfterSync {
  const executed = Number(input.executedQty);
  const orig = Number(input.origQty);
  if (!isExchangeSpotOrderTerminal(input.exchangeStatus)) {
    return "reconcile_required";
  }
  if (!Number.isFinite(executed) || !Number.isFinite(orig) || orig <= 0) {
    return "reconcile_required";
  }
  if (executed + 1e-8 >= orig) {
    return "executed";
  }
  return "partially_filled";
}

/**
 * 本地事件是否允许作为止盈续卖依据。
 * 必须：终态映射出的 partially_filled 或未卖满的 executed，且具备成交量/订单号/成交 ID。
 */
export function localEventEligibleForTakeProfitResume(event: {
  status: string;
  filledQty?: number;
  requestedQty: number;
  fillIds: string[];
  exchangeOrderId: string | null;
}): boolean {
  if (event.status === "pending" || event.status === "reconcile_required" || event.status === "blocked") {
    return false;
  }
  if (event.status !== "partially_filled" && event.status !== "executed") return false;
  if (!Number.isFinite(event.filledQty) || (event.filledQty as number) <= 0) return false;
  if (!Number.isFinite(event.requestedQty) || event.requestedQty <= 0) return false;
  if ((event.filledQty as number) + 1e-12 >= event.requestedQty) return false;
  if (!event.exchangeOrderId) return false;
  if (!Array.isArray(event.fillIds) || event.fillIds.length === 0) return false;
  return true;
}
