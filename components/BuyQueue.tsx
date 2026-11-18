"use client";

import { useEffect, useState } from "react";
import type { QueuedBuyOrder } from "@/lib/execution/types";
import { listBuyOrders } from "@/lib/execution/store.browser";
import { downloadQueuedOrdersCsv } from "@/lib/execution/csv";

const STATUS: Record<QueuedBuyOrder["status"], string> = {
  pending: "待执行",
  partially_filled: "部分成交",
  filled: "已完成",
  blocked: "已阻止",
  reconcile_required: "需人工对账",
  cancelled: "已取消",
};

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

export default function BuyQueue({ refreshKey }: { refreshKey: number }) {
  const [orders, setOrders] = useState<QueuedBuyOrder[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listBuyOrders()
      .then((rows) => {
        if (active) {
          setOrders(rows);
          setError(null);
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "读取待买队列失败");
      });
    return () => { active = false; };
  }, [refreshKey]);

  const openCount = orders.filter((order) =>
    order.status === "pending" || order.status === "partially_filled" || order.status === "reconcile_required"
  ).length;

  return (
    <section className="glass space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">待买队列</h3>
          <p className="mt-0.5 text-[11px] text-mute">策略信号已入队；当前不会自动向 Binance 提交订单。</p>
        </div>
        <button
          type="button"
          onClick={() => downloadQueuedOrdersCsv(orders)}
          disabled={orders.length === 0}
          className="rounded-full border border-line px-3 py-1 text-xs text-sub transition hover:text-fg disabled:opacity-40"
        >
          导出 CSV
        </button>
      </div>

      {error ? <p className="text-xs text-warn">{error}</p> : null}
      <div className="flex flex-wrap gap-3 text-[11px] text-mute">
        <span>总订单 {orders.length}</span>
        <span>待处理 {openCount}</span>
        <span>待买金额 {money(orders.filter((o) => o.status !== "filled" && o.status !== "cancelled").reduce((sum, o) => sum + o.remainingUsdt, 0))} USDT</span>
      </div>

      {orders.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-mute">
          暂无待买订单。只有新鲜、未被风控阻止的 Binance 买入信号才会进入队列。
        </p>
      ) : (
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {orders.map((order) => (
            <article key={order.id} className="rounded-lg border border-line bg-soft/40 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg">{order.symbol} <span className="ml-1 text-xs font-normal text-sub">{order.strategyLabel}</span></p>
                  <p className="mt-0.5 truncate text-[10px] text-mute">{order.eventKey}</p>
                </div>
                <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[10px] text-sub">
                  {STATUS[order.status]}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                <div><p className="text-mute">计划</p><p className="num text-fg">{money(order.plannedUsdt)}</p></div>
                <div><p className="text-mute">已成交</p><p className="num text-fg">{money(order.filledUsdt)}</p></div>
                <div><p className="text-mute">剩余</p><p className="num text-fg">{money(order.remainingUsdt)}</p></div>
              </div>
              {order.lastError ? <p className="mt-2 text-[10px] text-warn">{order.lastError}</p> : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
