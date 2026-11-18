"use client";

import { useEffect } from "react";
import { listBuyOrders } from "@/lib/execution/store.browser";
import { listSellEvents } from "@/lib/execution/sell-store.browser";
import { syncBuyOrderFromBinance } from "@/lib/execution/sync-buy-order.browser";
import { syncSellOrderFromBinance } from "@/lib/execution/sync-sell-order.browser";

/**
 * Dashboard-level background reconciler. It remains mounted even when the
 * queue tab is not selected. It is read-only and never submits/cancels orders.
 */
export default function ExecutionBackground({ onChange }: { onChange: () => void }) {
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
  }, [onChange]);

  return null;
}
