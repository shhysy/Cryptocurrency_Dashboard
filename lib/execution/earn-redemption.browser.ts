import {
  fetchFlexibleEarnRedemptionRecords,
  fetchFlexibleEarnUsdtPositions,
  fetchSpotAndEarnUsdtBalances,
  fetchSpotAssetBalance,
} from "../binance.browser";
import {
  allocateFlexibleEarnRedemption,
  availableFlexibleEarnUsdt,
  isEarnRedemptionCredited,
  matchEarnRedemptionRecord,
  createEarnRedemptionIntents,
  type EarnRedemptionIntent,
} from "./earn-redemption";
import {
  enqueueEarnRedemptionIntents,
  listBuyFundsReservations,
  listEarnRedemptionIntents,
  updateEarnRedemptionIntent,
} from "./store.browser";
import { planSpotFirstBuyFunding } from "./wallet-funds";

const ACTIVE_REDEMPTION_STATUSES = new Set([
  "planned", "submitting", "submitted", "redeeming", "reconcile_required",
]);

/**
 * Read current Spot + Simple Earn balances and persist a spot-first redemption
 * plan for one queued buy. This function performs GET requests and local
 * IndexedDB writes only; it never redeems or submits a Spot order.
 */
export async function prepareQueuedBuyEarnRedemption(input: {
  orderId: string;
  requestedUsdt: number;
}): Promise<{
  plan: ReturnType<typeof planSpotFirstBuyFunding> | null;
  intents: EarnRedemptionIntent[];
  createdIntents: number;
  existingIntents: number;
}> {
  if (!input.orderId.trim()) throw new Error("待买订单 ID 不能为空");
  if (!Number.isFinite(input.requestedUsdt) || input.requestedUsdt <= 0) {
    throw new Error("待买金额必须大于 0");
  }

  const priorIntents = await listEarnRedemptionIntents(input.orderId);
  const priorActive = priorIntents.filter((intent) => ACTIVE_REDEMPTION_STATUSES.has(intent.status));
  if (priorActive.length > 0) {
    return {
      plan: null,
      intents: priorActive,
      createdIntents: 0,
      existingIntents: priorActive.length,
    };
  }

  const [wallet, flexiblePositions, reservations, allEarnIntents] = await Promise.all([
    fetchSpotAndEarnUsdtBalances(),
    fetchFlexibleEarnUsdtPositions(),
    listBuyFundsReservations(),
    listEarnRedemptionIntents(),
  ]);

  const otherActiveSpotReservations = reservations
    .filter((item) => item.orderId !== input.orderId && item.status === "active")
    .reduce((sum, item) => sum + item.reservedUsdt, 0);
  const spotFreeAfterReservations = Math.max(0, wallet.spotFreeUsdt - otherActiveSpotReservations);

  const reservedByProduct: Record<string, number> = {};
  for (const intent of allEarnIntents) {
    if (intent.orderId === input.orderId || !ACTIVE_REDEMPTION_STATUSES.has(intent.status)) continue;
    reservedByProduct[intent.productId] = (reservedByProduct[intent.productId] ?? 0) + intent.amountUsdt;
  }
  const flexibleAvailable = availableFlexibleEarnUsdt(flexiblePositions, reservedByProduct);
  const plan = planSpotFirstBuyFunding(
    input.requestedUsdt,
    spotFreeAfterReservations,
    flexibleAvailable,
  );

  if (plan.flexibleEarnToRedeemUsdt <= 0) {
    return { plan, intents: [], createdIntents: 0, existingIntents: 0 };
  }

  const allocations = allocateFlexibleEarnRedemption(
    plan.flexibleEarnToRedeemUsdt,
    flexiblePositions,
    reservedByProduct,
  );
  const intents = createEarnRedemptionIntents({
    orderId: input.orderId,
    allocations,
    spotFreeBeforeUsdt: wallet.spotFreeUsdt,
  });
  const persisted = await enqueueEarnRedemptionIntents(intents);
  return {
    plan,
    intents,
    createdIntents: persisted.created,
    existingIntents: persisted.existing,
  };
}


/**
 * Read-only recovery for a redemption that already has a Binance redemptionId.
 * It never resubmits a redeem request. The intent becomes credited only when
 * both the exact exchange history record and the Spot free-balance increase
 * are observed.
 */
export async function reconcileEarnRedemptionIntent(
  intent: EarnRedemptionIntent,
): Promise<{ outcome: "waiting" | "credited" | "manual_review"; reason: string }> {
  if (!intent.redemptionId) {
    return {
      outcome: "manual_review",
      reason: "本地没有 Binance redemptionId；不能安全地自动匹配或重发赎回请求",
    };
  }
  const records = await fetchFlexibleEarnRedemptionRecords({
    redeemId: intent.redemptionId,
    startTime: Math.max(1, intent.createdAt - 60_000),
    endTime: Date.now(),
  });
  const record = matchEarnRedemptionRecord(intent, records);
  if (!record) {
    return {
      outcome: "waiting",
      reason: "尚未找到与 redemptionId、USDT 金额和 Spot 目的账户完全匹配的赎回记录",
    };
  }

  const spot = await fetchSpotAssetBalance("USDT");
  if (isEarnRedemptionCredited(intent, spot.free)) {
    if (intent.status !== "credited") {
      await updateEarnRedemptionIntent(intent.id, "credited", { lastError: null });
    }
    return { outcome: "credited", reason: "赎回记录与现货 USDT 到账余额均已核实" };
  }

  const exchangeStatus = String(record.status ?? "").toUpperCase();
  if (exchangeStatus === "PENDING" || exchangeStatus === "PROCESSING") {
    if (intent.status === "submitted") {
      await updateEarnRedemptionIntent(intent.id, "redeeming", { lastError: null });
    }
    return { outcome: "waiting", reason: "Binance 赎回仍在处理中，等待现货到账" };
  }
  if (intent.status !== "reconcile_required") {
    await updateEarnRedemptionIntent(
      intent.id,
      "reconcile_required",
      { lastError: "赎回记录存在，但现货 free 尚未确认足额到账" },
    );
  }
  return {
    outcome: "manual_review",
    reason: `赎回记录状态为 ${record.status ?? "未知"}，但现货 free 未体现完整到账，暂停自动买入`,
  };
}
