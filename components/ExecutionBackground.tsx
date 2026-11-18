"use client";

import { useEffect } from "react";
import type { DashboardData } from "@/lib/types";
import { strategyConfig } from "@/strategy.config";
import { listBuyOrders } from "@/lib/execution/store.browser";
import { listSellEvents } from "@/lib/execution/sell-store.browser";
import { syncBuyOrderFromBinance } from "@/lib/execution/sync-buy-order.browser";
import { syncSellOrderFromBinance } from "@/lib/execution/sync-sell-order.browser";
import { dispatchPendingTradeNotifications } from "@/lib/execution/notification-dispatch.browser";
import {
  LIVE_EARN_REDEMPTION_ENABLED,
  LIVE_SPOT_ORDER_SUBMISSION_ENABLED,
  LIVE_SPOT_SELL_SUBMISSION_ENABLED,
} from "@/lib/binance.browser";
import { prepareQueuedBuyDryRun } from "@/lib/execution/binance-order.browser";
import { submitQueuedBuyOrder } from "@/lib/execution/buy-order-submit.browser";
import {
  prepareQueuedBuyEarnRedemption,
  reconcileEarnRedemptionIntent,
  submitPlannedEarnRedemption,
} from "@/lib/execution/earn-redemption.browser";
import { submitQueuedSellEvent } from "@/lib/execution/sell-order-submit.browser";

/**
 * Dashboard-level background reconciler. It remains mounted even when the
 * queue tab is not selected. It is read-only and never submits/cancels orders.
 */
export default function ExecutionBackground({ onChange, data }: { onChange: () => void; data: DashboardData }) {
  useEffect(() => {
    let active = true;
    let running = false;
    const inFlight = new Set<string>();

    const tick = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      let changed = false;
      try {
        const buyOrders = await listBuyOrders();
        for (const order of buyOrders) {
          if (!active) return;
          if (order.status !== "reconcile_required" || order.attemptCount <= 0) continue;
          const key = "BUY:" + order.id;
          if (inFlight.has(key)) continue;
          inFlight.add(key);
          try {
            const result = await syncBuyOrderFromBinance(order.id, order.attemptCount - 1);
            if (result.action !== "wait" || result.newlyRecordedFills > 0) changed = true;
          } catch (error) {
            console.warn("[execution-reconcile] BUY", order.id, error);
          } finally {
            inFlight.delete(key);
          }
        }

        const sellEvents = await listSellEvents();
        for (const event of sellEvents) {
          if (!active) return;
          if (event.status !== "reconcile_required" ||
              (!event.clientOrderId && !event.exchangeOrderId)) continue;
          const key = "SELL:" + event.eventKey;
          if (inFlight.has(key)) continue;
          inFlight.add(key);
          try {
            const result = await syncSellOrderFromBinance(event.eventKey);
            if (result.action !== "wait" || result.newlyRecordedFills > 0) changed = true;
          } catch (error) {
            console.warn("[execution-reconcile] SELL", event.eventKey, error);
          } finally {
            inFlight.delete(key);
          }
        }
        // Live execution is deliberately gated by independent, compile-time
        // switches. All three switches remain false in the checked-in build.
        if (active && data.source === "binance" && !data.stale && data.market.accountKnown) {
          if (LIVE_SPOT_ORDER_SUBMISSION_ENABLED) {
            const queuedBuys = await listBuyOrders();
            for (const order of queuedBuys) {
              if (!active) return;
              if (order.status !== "pending" && order.status !== "partially_filled") continue;
              const coin = data.coins.find((item) =>
                item.symbol === order.symbol || item.symbol + order.quoteAsset === order.symbol
              );
              if (!coin) continue;
              const capUsdt = strategyConfig.profiles[coin.signal.group].capUsdt;
              const remainingCapUsdt = Math.max(0, capUsdt - (coin.invested ?? 0));
              if (remainingCapUsdt <= 1e-8) continue;

              try {
                if (LIVE_EARN_REDEMPTION_ENABLED) {
                  const funding = await prepareQueuedBuyEarnRedemption({
                    orderId: order.id,
                    requestedUsdt: Math.min(order.remainingUsdt, remainingCapUsdt),
                    symbol: order.symbol,
                    quoteAsset: order.quoteAsset,
                  });
                  if (funding.intents.length > 0) {
                    for (const intent of funding.intents) {
                      if (!active) return;
                      if (intent.status === "planned") {
                        await submitPlannedEarnRedemption(intent.id);
                        changed = true;
                      } else if (["submitting", "submitted", "redeeming", "reconcile_required"].includes(intent.status)) {
                        const result = await reconcileEarnRedemptionIntent(intent);
                        if (result.outcome !== "waiting") changed = true;
                      }
                    }
                    // Do not buy against a balance snapshot taken before redemption.
                    break;
                  }
                }

                const preview = await prepareQueuedBuyDryRun(order, remainingCapUsdt);
                if (preview.ok && preview.executableUsdt > 0) {
                  await submitQueuedBuyOrder(order.id, remainingCapUsdt);
                  changed = true;
                  break;
                }
              } catch (error) {
                console.warn("[execution-submit] BUY blocked", order.id, error);
              }
            }
          }

          if (LIVE_SPOT_SELL_SUBMISSION_ENABLED) {
            const queuedSells = await listSellEvents();
            const event = queuedSells.find((item) =>
              item.status === "pending" &&
              ["take_profit", "indicator_profit", "trail_stop", "base_reduce"].includes(item.kind)
            );
            if (event) {
              try {
                await submitQueuedSellEvent(event.eventKey);
                changed = true;
              } catch (error) {
                console.warn("[execution-submit] SELL blocked", event.eventKey, error);
              }
            }
          }
        }

        const notifications = await dispatchPendingTradeNotifications();
        if (notifications.sent > 0) changed = true;
        if (notifications.failed > 0) {
          console.warn("[trade-notifications] delivery failed", notifications.reason);
        }
        if (active && changed) onChange();
      } catch (error) {
        console.warn("[execution-reconcile] background tick failed", error);
      } finally {
        running = false;
      }
    };

    const timer = window.setInterval(() => { void tick(); }, 30_000);
    void tick();
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [onChange, data]);

  return null;
}
