"use client";

import { useEffect, useRef } from "react";
import type { DashboardData } from "@/lib/types";
import { strategyConfig } from "@/strategy.config";
import { listBuyOrders } from "@/lib/execution/store.browser";
import { syncBuyOrderFromBinance } from "@/lib/execution/sync-buy-order.browser";
import {
  LIVE_EARN_REDEMPTION_ENABLED,
  BINANCE_SPOT_BUY_SUBMISSION_ENABLED,
} from "@/lib/binance.browser";
import { prepareQueuedBuyDryRun } from "@/lib/execution/binance-order.browser";
import { submitQueuedBuyOrder } from "@/lib/execution/buy-order-submit.browser";
import {
  prepareQueuedBuyEarnRedemption,
  reconcileEarnRedemptionIntent,
  submitPlannedEarnRedemption,
} from "@/lib/execution/earn-redemption.browser";
import { runSellAutomationTick } from "@/lib/execution/sell-automation-tick";

/**
 * 看板级后台对账与受控提交。
 * 对账默认只读；测试网新单提交依赖看板最近一次刷新有效且 executionAllowed。
 * 卖出链路统一走 runSellAutomationTick（入队 → 对账 → 受控提交 → 通知）。
 */
export default function ExecutionBackground({
  onChange,
  data,
  executionAllowed,
}: {
  onChange: () => void;
  data: DashboardData;
  executionAllowed: boolean;
}) {
  const inFlight = useRef(new Set<string>());
  useEffect(() => {
    let active = true;
    let running = false;
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
          if (inFlight.current.has(key)) continue;
          inFlight.current.add(key);
          try {
            const result = await syncBuyOrderFromBinance(order.id, order.attemptCount - 1);
            if (result.action !== "wait" || result.newlyRecordedFills > 0) changed = true;
          } catch (error) {
            console.warn("[execution-reconcile] BUY", order.id, error);
          } finally {
            inFlight.current.delete(key);
          }
        }

        // 卖出：统一节拍（含信号入队、对账、可选提交、成交通知）
        try {
          const sellTick = await runSellAutomationTick(data, {
            attemptLiveSubmit: executionAllowed,
          });
          if (
            sellTick.enqueued > 0 ||
            sellTick.synced > 0 ||
            sellTick.submitted > 0 ||
            sellTick.notificationsSent > 0
          ) {
            changed = true;
          }
          if (sellTick.errors.length > 0) {
            console.warn("[execution-sell-tick]", sellTick.errors.slice(0, 3).join("；"));
          }
        } catch (error) {
          console.warn("[execution-sell-tick] failed", error);
        }

        // 买入提交仍由本组件编排（GPT 主责）；仅在许可与数据新鲜时尝试
        const dataAgeMs = Date.now() - data.updatedAt;
        const dataFresh = dataAgeMs >= 0 && dataAgeMs <= 120_000;
        if (active && executionAllowed && dataFresh &&
            data.source === "binance" && !data.stale && data.market.accountKnown) {
          if (BINANCE_SPOT_BUY_SUBMISSION_ENABLED) {
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
                    // 赎回到账前的余额快照不得用于买入
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
  }, [onChange, data, executionAllowed]);

  return null;
}
