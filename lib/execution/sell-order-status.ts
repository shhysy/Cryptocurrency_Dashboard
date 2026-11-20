/**
 * 卖出订单：交易所状态 → 本地事件状态映射（纯函数，无 IO）。
 * 非终态不得标记为可续卖的 partially_filled；
 * 仅 FILLED / CANCELED / EXPIRED / EXPIRED_IN_MATCH / REJECTED 进入终态分支。
 */

export type LocalSellStatusAfterSync =
  | "executed"
  | "partially_filled"
  | "reconcile_required";

/**
 * 数量比较容差：优先 stepSize；否则用相对误差，避免小数量被固定 1e-8 误判。
 */
export function quantityTolerance(referenceQty: number, stepSize?: number): number {
  if (Number.isFinite(stepSize) && (stepSize as number) > 0) {
    return Math.max(1e-15, (stepSize as number) * 0.51);
  }
  const scale = Math.max(Math.abs(referenceQty), 1e-18);
  return Math.max(1e-15, scale * 1e-9);
}

/** executed 是否已达到或超过 target（含安全容差） */
export function qtyMeetsOrExceeds(executed: number, target: number, stepSize?: number): boolean {
  if (!Number.isFinite(executed) || !Number.isFinite(target) || target <= 0) return false;
  return executed + quantityTolerance(target, stepSize) >= target;
}

/** 币安现货订单是否已进入终态（不会再有新成交） */
export function isExchangeSpotOrderTerminal(exchangeStatus: string): boolean {
  const status = String(exchangeStatus || "").toUpperCase();
  return (
    status === "FILLED" ||
    status === "CANCELED" ||
    status === "EXPIRED" ||
    status === "EXPIRED_IN_MATCH" ||
    status === "REJECTED"
  );
}

/**
 * 成交明细与订单累计核对一致后，决定本地事件状态。
 * - 非终态 → reconcile_required（禁止 resume）
 * - 终态且卖满 → executed
 * - 终态未卖满 → partially_filled（仅此状态可在字段齐全时 resume）
 */
export function localSellStatusAfterReconciledSnapshot(input: {
  exchangeStatus: string;
  executedQty: number;
  origQty: number;
  /** 可选：交易对 LOT_SIZE stepSize，用于精度安全比较 */
  stepSize?: number;
}): LocalSellStatusAfterSync {
  const executed = Number(input.executedQty);
  const orig = Number(input.origQty);
  if (!isExchangeSpotOrderTerminal(input.exchangeStatus)) {
    return "reconcile_required";
  }
  if (!Number.isFinite(executed) || !Number.isFinite(orig) || orig <= 0 || executed < 0) {
    return "reconcile_required";
  }
  if (qtyMeetsOrExceeds(executed, orig, input.stepSize)) {
    return "executed";
  }
  return "partially_filled";
}

/**
 * 仅终态未卖满的 partially_filled 且对账字段齐全时允许止盈续卖。
 * executed（含 filledQty < requested）一律不可 resume。
 */
export function localEventEligibleForTakeProfitResume(event: {
  status: string;
  filledQty?: number;
  requestedQty: number;
  fillIds: string[];
  exchangeOrderId: string | null;
  stepSize?: number;
}): boolean {
  if (event.status !== "partially_filled") return false;
  if (!Number.isFinite(event.filledQty) || (event.filledQty as number) <= 0) return false;
  if (!Number.isFinite(event.requestedQty) || event.requestedQty <= 0) return false;
  if (qtyMeetsOrExceeds(event.filledQty as number, event.requestedQty, event.stepSize)) return false;
  if (!event.exchangeOrderId) return false;
  if (!Array.isArray(event.fillIds) || event.fillIds.length === 0) return false;
  return true;
}
