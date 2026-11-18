"use client";

import { useEffect, useRef, useState } from "react";
import { listSellEvents, type SellEventRecord } from "@/lib/execution/sell-store.browser";
import { syncSellOrderFromBinance } from "@/lib/execution/sync-sell-order.browser";
import { LIVE_SPOT_SELL_SUBMISSION_ENABLED } from "@/lib/binance.browser";
import { submitQueuedSellEvent } from "@/lib/execution/sell-order-submit.browser";

const STATUS: Record<SellEventRecord["status"], string> = {
  pending: "待执行",
  reconcile_required: "需人工对账",
  partially_filled: "部分成交（已终态）",
  executed: "已成交",
  blocked: "已阻止",
};

const KIND: Record<string, string> = {
  take_profit: "止盈",
  indicator_profit: "指标止盈",
  trail_stop: "追踪止损",
  base_reduce: "底仓减仓",
  fundamental_exit: "基本面退出",
};

export default function SellQueue({ refreshKey }: { refreshKey: number }) {
  const [events, setEvents] = useState<SellEventRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [syncLoading, setSyncLoading] = useState<Record<string, boolean>>({});
  const [syncMessages, setSyncMessages] = useState<Record<string, string>>({});
  const [submitLoading, setSubmitLoading] = useState<Record<string, boolean>>({});
  const [submitMessages, setSubmitMessages] = useState<Record<string, string>>({});
  const sellSyncInFlight = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    listSellEvents()
      .then((rows) => {
        if (active) {
          setEvents(rows);
          setError(null);
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "读取卖出事件失败");
      });
    return () => { active = false; };
  }, [refreshKey]);

  // Poll only events with a persisted exchange/client order identifier.
  // The operation is read-only and never submits or retries a SELL POST.
  useEffect(() => {
    let active = true;
    let running = false;
    const reconcileOpenSellOrders = async () => {
      if (running) return;
      running = true;
      try {
        const rows = await listSellEvents();
        for (const event of rows) {
          if (!active) break;
          if (event.status !== "reconcile_required" ||
              (!event.clientOrderId && !event.exchangeOrderId)) continue;
          if (sellSyncInFlight.current.has(event.eventKey)) continue;
          sellSyncInFlight.current.add(event.eventKey);
          setSyncLoading((current) => ({ ...current, [event.eventKey]: true }));
          try {
            const result = await syncSellOrderFromBinance(event.eventKey);
            setSyncMessages((current) => ({
              ...current,
              [event.eventKey]: result.reason ??
                `自动对账：${result.action}；新增成交 ${result.newlyRecordedFills} 笔`,
            }));
          } catch (e) {
            setSyncMessages((current) => ({
              ...current,
              [event.eventKey]: e instanceof Error ? e.message : "自动卖单对账失败",
            }));
          } finally {
            sellSyncInFlight.current.delete(event.eventKey);
            setSyncLoading((current) => ({ ...current, [event.eventKey]: false }));
          }
        }
        if (active) setEvents(await listSellEvents());
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "自动刷新卖单对账失败");
      } finally {
        running = false;
      }
    };
    const timer = window.setInterval(() => { void reconcileOpenSellOrders(); }, 30_000);
    void reconcileOpenSellOrders();
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refreshKey]);

  const reconcileSellEvent = async (event: SellEventRecord) => {
    if (sellSyncInFlight.current.has(event.eventKey)) return;
    sellSyncInFlight.current.add(event.eventKey);
    setSyncLoading((current) => ({ ...current, [event.eventKey]: true }));
    setSyncMessages((current) => ({ ...current, [event.eventKey]: "" }));
    try {
      const result = await syncSellOrderFromBinance(event.eventKey);
      setSyncMessages((current) => ({
        ...current,
        [event.eventKey]: result.reason ?? `对账结果：${result.action}；新增成交 ${result.newlyRecordedFills} 笔`,
      }));
      setEvents(await listSellEvents());
    } catch (e) {
      setSyncMessages((current) => ({
        ...current,
        [event.eventKey]: e instanceof Error ? e.message : "卖单对账失败",
      }));
    } finally {
      sellSyncInFlight.current.delete(event.eventKey);
      setSyncLoading((current) => ({ ...current, [event.eventKey]: false }));
    }
  };

  const submitSell = async (event: SellEventRecord) => {
    setSubmitLoading((current) => ({ ...current, [event.eventKey]: true }));
    setSubmitMessages((current) => ({ ...current, [event.eventKey]: "" }));
    try {
      const result = await submitQueuedSellEvent(event.eventKey);
      setSubmitMessages((current) => ({
        ...current,
        [event.eventKey]: result.reason ?? (result.submitted ? "卖单已提交，等待对账" : "卖单未提交"),
      }));
      setEvents(await listSellEvents());
    } catch (e) {
      setSubmitMessages((current) => ({
        ...current,
        [event.eventKey]: e instanceof Error ? e.message : "卖单提交失败",
      }));
    } finally {
      setSubmitLoading((current) => ({ ...current, [event.eventKey]: false }));
    }
  };

  const openCount = events.filter((event) =>
    event.status === "pending" || event.status === "reconcile_required"
  ).length;

  return (
    <section className="glass space-y-3 p-3">
      <div>
        <h3 className="text-sm font-semibold text-fg">待卖事件</h3>
        <p className="mt-0.5 text-[11px] text-mute">策略卖出信号已预留并做仓位保护；当前不会向 Binance 提交卖单。</p>
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-mute">
        <span>事件 {events.length}</span>
        <span>待处理 {openCount}</span>
      </div>
      {error ? <p className="text-xs text-warn">{error}</p> : null}
      {events.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-mute">
          暂无待卖事件。
        </p>
      ) : (
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {events.map((event) => (
            <article key={event.eventKey} className="rounded-lg border border-line bg-soft/40 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg">{event.symbol} <span className="ml-1 text-xs font-normal text-sub">{KIND[event.kind] ?? event.kind}</span></p>
                  <p className="mt-0.5 truncate text-[10px] text-mute">{event.eventKey}</p>
                </div>
                <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[10px] text-sub">{STATUS[event.status]}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <div><p className="text-mute">预留卖出数量</p><p className="num text-fg">{event.requestedQty.toPrecision(8).replace(/\.?0+$/, "")}</p></div>
                <div><p className="text-mute">实际成交数量</p><p className="num text-fg">{(event.filledQty ?? 0).toPrecision(8).replace(/\.?0+$/, "")}</p></div>
                <div><p className="text-mute">已确认成交笔数</p><p className="num text-fg">{event.fillIds.length}</p></div>
              </div>
              {event.lastError ? <p className="mt-2 text-[10px] text-warn">{event.lastError}</p> : null}
              {event.status === "pending" ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!LIVE_SPOT_SELL_SUBMISSION_ENABLED || Boolean(submitLoading[event.eventKey])}
                    onClick={() => void submitSell(event)}
                    className="rounded-full border border-line px-3 py-1 text-[10px] text-sub hover:text-fg disabled:opacity-40"
                    title="实盘卖出开关关闭时不可用"
                  >
                    {submitLoading[event.eventKey] ? "提交中…" : LIVE_SPOT_SELL_SUBMISSION_ENABLED ? "执行卖出" : "实盘卖出未启用"}
                  </button>
                  {submitMessages[event.eventKey] ? <p className="text-[10px] text-mute">{submitMessages[event.eventKey]}</p> : null}
                </div>
              ) : null}
              {event.status === "reconcile_required" && (event.clientOrderId || event.exchangeOrderId) ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={Boolean(syncLoading[event.eventKey])}
                    onClick={() => void reconcileSellEvent(event)}
                    className="rounded-full border border-gold/40 px-3 py-1 text-[10px] text-gold hover:bg-gold/10 disabled:opacity-40"
                  >
                    {syncLoading[event.eventKey] ? "对账中…" : "核对 Binance 卖单"}
                  </button>
                  {syncMessages[event.eventKey] ? <p className="text-[10px] text-mute">{syncMessages[event.eventKey]}</p> : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
