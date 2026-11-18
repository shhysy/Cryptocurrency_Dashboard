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

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Allocate only the Spot shortfall across eligible USDT Flexible Earn products.
 * Locked products are never passed to this function. Values are rounded down
 * to 8 decimal places to avoid requesting more than the observed available qty.
 */
export function allocateFlexibleEarnRedemption(
  requiredUsdt: number,
  positions: SimpleEarnPositionRow[],
): EarnRedemptionAllocation[] {
  positiveAmount(requiredUsdt, "待赎回金额");
  let remaining = Math.floor(requiredUsdt * 1e8) / 1e8;
  const allocations: EarnRedemptionAllocation[] = [];
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
    const available = Math.max(0, total - redeeming - frozen);
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
  return allocations;
}

/** Stable per-order/product key. Rebuilding the same plan cannot create a second intent. */
export function createEarnRedemptionIntents(input: {
  orderId: string;
  allocations: EarnRedemptionAllocation[];
  now?: number;
}): EarnRedemptionIntent[] {
  if (!input.orderId.trim()) throw new Error("赎回计划缺少待买订单 ID");
  const now = input.now ?? Date.now();
  return input.allocations.map((allocation) => {
    positiveAmount(allocation.amountUsdt, "赎回金额");
    if (!allocation.productId.trim() || allocation.amountUsdt <= 0) {
      throw new Error("赎回产品或金额无效");
    }
    const identity = `${input.orderId}|${allocation.productId}|USDT`;
    return {
      id: `earn-redeem:${stableHash(identity)}`,
      orderId: input.orderId,
      productId: allocation.productId,
      asset: "USDT",
      amountUsdt: allocation.amountUsdt,
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
