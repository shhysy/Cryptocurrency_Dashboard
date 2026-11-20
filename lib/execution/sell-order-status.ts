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
 * 仅容忍 IEEE-754 表示误差，不得用 stepSize 半步把未成交差额抬成卖满。
 * stepSize 仅用于独立校验数量是否为合法步长倍数，不参与满单判定放大。
 */
export function quantityTolerance(referenceQty: number, _stepSize?: number): number {
  const scale = Math.max(Math.abs(referenceQty), 1e-18);
  return Math.max(Number.EPSILON * Math.max(1, scale), scale * 1e-15);
}

/** executed 是否已达到或超过 target（仅浮点表示误差） */
export function qtyMeetsOrExceeds(executed: number, target: number, stepSize?: number): boolean {
  if (!Number.isFinite(executed) || !Number.isFinite(target) || target <= 0) return false;
  return executed + quantityTolerance(target, stepSize) >= target;
}

/** 数量是否为 stepSize 的整数倍（用于规则校验，不用于抬高成交） */
export function qtyIsStepMultiple(qty: number, stepSize: number): boolean {
  if (!Number.isFinite(qty) || qty < 0) return false;
  if (!Number.isFinite(stepSize) || stepSize <= 0) return false;
  const n = qty / stepSize;
  const nearest = Math.round(n);
  return Math.abs(n - nearest) <= 1e-9;
}

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

export function localSellStatusAfterReconciledSnapshot(input: {
  exchangeStatus: string;
  executedQty: number;
  origQty: number;
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
  if (Number.isFinite(input.stepSize) && (input.stepSize as number) > 0) {
    if (!qtyIsStepMultiple(executed, input.stepSize as number) && executed > 0) {
      return "reconcile_required";
    }
  }
  if (qtyMeetsOrExceeds(executed, orig, input.stepSize)) {
    return "executed";
  }
  return "partially_filled";
}

function fillIdsAreValidProof(fillIds: unknown): boolean {
  if (!Array.isArray(fillIds) || fillIds.length === 0) return false;
  const normalized: string[] = [];
  for (const id of fillIds) {
    if (typeof id !== "string") return false;
    const t = id.trim();
    if (!t) return false;
    normalized.push(t);
  }
  return new Set(normalized).size === normalized.length;
}

/**
 * 仅终态未卖满的 partially_filled，且具备可验证对账证明时允许止盈续卖。
 * 旧 IndexedDB 缺少证明字段时一律冻结（返回 false）。
 */
export function localEventEligibleForTakeProfitResume(event: {
  status: string;
  filledQty?: number;
  requestedQty: number;
  fillIds: string[];
  exchangeOrderId: string | null;
  stepSize?: number;
  lotStepSize?: number;
  exchangeTerminalStatus?: string;
  fillReconcileCompletedAt?: number;
}): boolean {
  if (event.status !== "partially_filled") return false;
  if (!event.exchangeTerminalStatus || !isExchangeSpotOrderTerminal(event.exchangeTerminalStatus)) {
    return false;
  }
  if (!Number.isSafeInteger(event.fillReconcileCompletedAt) || (event.fillReconcileCompletedAt as number) <= 0) {
    return false;
  }
  const step = event.stepSize ?? event.lotStepSize;
  if (!Number.isFinite(event.filledQty) || (event.filledQty as number) <= 0) return false;
  if (!Number.isFinite(event.requestedQty) || event.requestedQty <= 0) return false;
  if (qtyMeetsOrExceeds(event.filledQty as number, event.requestedQty, step)) return false;
  if (!event.exchangeOrderId) return false;
  if (!fillIdsAreValidProof(event.fillIds)) return false;
  return true;
}
