import {
  fetchFlexibleEarnUsdtPositions,
  fetchSpotAndEarnUsdtBalances,
} from "../binance.browser";
import {
  allocateFlexibleEarnRedemption,
  availableFlexibleEarnUsdt,
  createEarnRedemptionIntents,
  type EarnRedemptionIntent,
} from "./earn-redemption";
import {
  enqueueEarnRedemptionIntents,
  listBuyFundsReservations,
  listEarnRedemptionIntents,
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
  plan: ReturnType<typeof planSpotFirstBuyFunding>;
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
      plan: {
        requestedUsdt: input.requestedUsdt,
        spotToUseUsdt: 0,
        flexibleEarnToRedeemUsdt: priorActive.reduce((sum, item) => sum + item.amountUsdt, 0),
        unfundedUsdt: 0,
      },
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
  return { plan, intents, ...persisted };
}
