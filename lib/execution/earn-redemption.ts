import type { SimpleEarnPositionRow } from "./wallet-funds";

export type EarnRedemptionStatus =
  | "planned"
  | "submitting"
  | "submitted"
  | "redeeming"
  | "credited"
  | "reconcile_required"
  | "failed";

export interface EarnRedemptionIntent {
  id: string;
  orderId: string;
  productId: string;
  asset: "USDT";
  amountUsdt: number;
  spotFreeBeforeUsdt: number | null;
  status: EarnRedemptionStatus;
  redemptionId: string | null;
  createdAt: number;
  updatedAt: number;
  lastError: string | null;
}

export interface EarnRedemptionAllocation {
  productId: string;
  amountUsdt: number;
}

function positiveAmount(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} 必须是非负有限数值`);
  return value;
}

/**
 * Allocate only the Spot shortfall across eligible USDT Flexible Earn products.
 * Locked products are never passed to this function. Values are rounded down
 * to 8 decimal places to avoid requesting more than the observed available qty.
 */
export function allocateFlexibleEarnRedemption(
  requiredUsdt: number,
  positions: SimpleEarnPositionRow[],
  reservedByProduct: Record<string, number> = {},
): EarnRedemptionAllocation[] {
  positiveAmount(requiredUsdt, "待赎回金额");
  let remaining = Math.floor(requiredUsdt * 1e8) / 1e8;
  const allocations: EarnRedemptionAllocation[] = [];
  const remainingReservations = { ...reservedByProduct };
  const eligible = positions
    .filter((row) => row.asset === "USDT")
    .sort((a, b) => String(a.productId ?? "").localeCompare(String(b.productId ?? "")));

  for (const row of eligible) {
    const total = Number(row.amount);
    const redeeming = Number(row.redeemingAmt ?? "0");
    const frozen = Number(row.freezeAmount ?? "0");
    positiveAmount(total, "理财持仓");
    positiveAmount(redeeming, "赎回中金额");
    positiveAmount(frozen, "冻结金额");
    if (redeeming + frozen > total + 1e-10) throw new Error("理财冻结/赎回中数量超过持仓总量");
    const productKey = row.productId ? String(row.productId) : "";
    const locallyReserved = productKey ? (remainingReservations[productKey] ?? 0) : 0;
    positiveAmount(locallyReserved, "本地已预留赎回金额");
    const reservedHere = Math.min(locallyReserved, total);
    if (productKey) remainingReservations[productKey] = Math.max(0, locallyReserved - reservedHere);
    const available = Math.max(0, total - redeeming - frozen - reservedHere);
    const take = Math.floor(Math.min(remaining, available) * 1e8) / 1e8;
    if (take <= 0) continue;
    if (!row.productId || !String(row.productId).trim()) {
      throw new Error("USDT 活期理财持仓缺少 productId，无法安全生成赎回计划");
    }
    allocations.push({ productId: String(row.productId), amountUsdt: take });
    remaining = Math.max(0, Math.round((remaining - take) * 1e8) / 1e8);
    if (remaining <= 1e-8) break;
  }
  if (remaining > 1e-8) throw new Error(`活期理财可赎回余额不足，尚缺 ${remaining.toFixed(8)} USDT`);
  const combined = new Map<string, number>();
  for (const allocation of allocations) {
    combined.set(allocation.productId, (combined.get(allocation.productId) ?? 0) + allocation.amountUsdt);
  }
  return Array.from(combined, ([productId, amountUsdt]) => ({ productId, amountUsdt }));
}

/** Stable per-order/product key. Rebuilding the same plan cannot create a second intent. */
export function createEarnRedemptionIntents(input: {
  orderId: string;
  allocations: EarnRedemptionAllocation[];
  now?: number;
  spotFreeBeforeUsdt?: number;
}): EarnRedemptionIntent[] {
  if (!input.orderId.trim()) throw new Error("赎回计划缺少待买订单 ID");
  const now = input.now ?? Date.now();
  const spotFreeBeforeUsdt = input.spotFreeBeforeUsdt === undefined
    ? null : positiveAmount(input.spotFreeBeforeUsdt, "赎回前现货 USDT");
  return input.allocations.map((allocation) => {
    positiveAmount(allocation.amountUsdt, "赎回金额");
    if (!allocation.productId.trim() || allocation.amountUsdt <= 0) {
      throw new Error("赎回产品或金额无效");
    }
    return {
      id: `earn-redeem:${encodeURIComponent(input.orderId)}:${encodeURIComponent(allocation.productId)}:USDT`,
      orderId: input.orderId,
      productId: allocation.productId,
      asset: "USDT",
      amountUsdt: allocation.amountUsdt,
      spotFreeBeforeUsdt,
      status: "planned",
      redemptionId: null,
      createdAt: now,
      updatedAt: now,
      lastError: null,
    };
  });
}

const transitions: Record<EarnRedemptionStatus, EarnRedemptionStatus[]> = {
  planned: ["submitting", "failed"],
  submitting: ["submitted", "reconcile_required", "failed"],
  submitted: ["redeeming", "credited", "reconcile_required", "failed"],
  redeeming: ["credited", "reconcile_required", "failed"],
  credited: [],
  reconcile_required: ["submitted", "redeeming", "credited", "failed"],
  failed: [],
};

/**
 * Enforce fail-closed state changes. A timed-out POST must move to
 * reconcile_required; it must never be blindly retried from that state.
 */
export function transitionEarnRedemption(
  current: EarnRedemptionIntent,
  nextStatus: EarnRedemptionStatus,
  patch: Partial<Pick<EarnRedemptionIntent, "redemptionId" | "lastError">> = {},
  now = Date.now(),
): EarnRedemptionIntent {
  if (!transitions[current.status].includes(nextStatus)) {
    throw new Error(`不允许赎回状态从 ${current.status} 转为 ${nextStatus}`);
  }
  if (current.status === "reconcile_required" && nextStatus === "submitted" && !patch.redemptionId && !current.redemptionId) {
    throw new Error("未通过赎回历史记录核实 redemptionId，不允许恢复为已提交");
  }
  return { ...current, ...patch, status: nextStatus, updatedAt: now };
}

/** POST timeout/connection loss is ambiguous: preserve intent and require history reconciliation. */
export function markEarnRedemptionAmbiguous(
  current: EarnRedemptionIntent,
  reason: string,
  now = Date.now(),
): EarnRedemptionIntent {
  if (current.status !== "submitting" && current.status !== "submitted" && current.status !== "redeeming") {
    throw new Error("只有正在提交或等待赎回的事件可以进入人工复核");
  }
  return transitionEarnRedemption(
    current,
    "reconcile_required",
    { lastError: reason.slice(0, 500) },
    now,
  );
}


/** Sum eligible Flexible Earn USDT after exchange locks and local pending redemption intents. */
export function availableFlexibleEarnUsdt(
  positions: SimpleEarnPositionRow[],
  reservedByProduct: Record<string, number> = {},
): number {
  const remainingReservations = { ...reservedByProduct };
  return positions.filter((row) => row.asset === "USDT").reduce((total, row) => {
    const gross = Number(row.amount);
    const redeeming = Number(row.redeemingAmt ?? "0");
    const frozen = Number(row.freezeAmount ?? "0");
    positiveAmount(gross, "理财持仓");
    positiveAmount(redeeming, "赎回中金额");
    positiveAmount(frozen, "冻结金额");
    if (redeeming + frozen > gross + 1e-10) throw new Error("理财冻结/赎回中数量超过持仓总量");
    const productKey = row.productId ? String(row.productId) : "";
    const locallyReserved = productKey ? (remainingReservations[productKey] ?? 0) : 0;
    positiveAmount(locallyReserved, "本地已预留赎回金额");
    const reservedHere = Math.min(locallyReserved, gross);
    if (productKey) remainingReservations[productKey] = Math.max(0, locallyReserved - reservedHere);
    return total + Math.max(0, gross - redeeming - frozen - reservedHere);
  }, 0);
}


/** A redemption record is accepted only when its exact exchange ID is known. */
export function matchEarnRedemptionRecord<T extends {
  redeemId?: number | string;
  asset?: string;
  amount?: string;
  destAccount?: string;
}>(
  intent: EarnRedemptionIntent,
  records: T[],
): T | null {
  if (!intent.redemptionId) return null;
  const matches = records.filter((record) =>
    String(record.redeemId ?? "") === intent.redemptionId &&
    record.asset === "USDT" &&
    record.destAccount === "SPOT" &&
    Number(record.amount) === intent.amountUsdt
  );
  return matches.length === 1 ? matches[0] : null;
}

/** Recover a lost POST response only from one unique, exact exchange history row. */
export function findUniqueEarnRedemptionRecord<T extends {
  redeemId?: number | string;
  productId?: string;
  projectId?: string;
  asset?: string;
  amount?: string;
  destAccount?: string;
}>(
  intent: EarnRedemptionIntent,
  records: T[],
): T | null {
  const matches = records.filter((record) =>
    record.redeemId !== undefined &&
    (record.projectId === intent.productId || record.productId === intent.productId) &&
    record.asset === "USDT" &&
    record.destAccount === "SPOT" &&
    Number(record.amount) === intent.amountUsdt
  );
  return matches.length === 1 ? matches[0] : null;
}

/** Conservative balance confirmation: Spot free must reflect the full redemption on top of baseline. */
export function isEarnRedemptionCredited(
  intent: EarnRedemptionIntent,
  currentSpotFreeUsdt: number,
  toleranceUsdt = 1e-8,
): boolean {
  positiveAmount(currentSpotFreeUsdt, "当前现货 USDT");
  positiveAmount(toleranceUsdt, "到账核对容差");
  if (intent.spotFreeBeforeUsdt === null) return false;
  return currentSpotFreeUsdt + toleranceUsdt >=
    intent.spotFreeBeforeUsdt + intent.amountUsdt;
}
