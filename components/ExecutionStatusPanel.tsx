"use client";

import { useEffect, useState } from "react";
import { listBuyOrders, listBuyFundsReservations, listTradeNotificationOutbox } from "@/lib/execution/store.browser";
import { listSellEvents } from "@/lib/execution/sell-store.browser";
import type { QueuedBuyOrder } from "@/lib/execution/types";
import type { SellEventRecord } from "@/lib/execution/sell-store.browser";
import type { BuyFundsReservation } from "@/lib/execution/fund-reservation";
import type { TradeNotificationOutboxEvent } from "@/lib/execution/notification-outbox";

type Snapshot = {
  buys: QueuedBuyOrder[];
  sells: SellEventRecord[];
  reservations: BuyFundsReservation[];
  notifications: TradeNotificationOutboxEvent[];
};

const money = (value: number) => new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(value);

function Metric({ label, value, detail, warning = false }: {
  label: string;
  value: string | number;
  detail: string;
  warning?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-soft/40 p-2.5">
      <p className="text-[10px] text-mute">{label}</p>
      <p className={`num mt-1 text-lg font-semibold ${warning ? "text-warn" : "text-fg"}`}>{value}</p>
      <p className="mt-0.5 text-[10px] text-mute">{detail}</p>
    </div>
  );
}

/**
 * Read-only overview of the existing execution stores.
 * This is a projection only: it does not create, cancel, submit or reconcile orders.
 */
export default function ExecutionStatusPanel({ refreshKey }: { refreshKey: number }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      listBuyOrders(),
      listSellEvents(),
      listBuyFundsReservations(),
      listTradeNotificationOutbox(),
    ]).then(([buys, sells, reservations, notifications]) => {
      if (!active) return;
      setSnapshot({ buys, sells, reservations, notifications });
      setError(null);
    }).catch((cause) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : "读取执行状态失败");
      setSnapshot(null);
    });
    return () => { active = false; };
  }, [refreshKey]);

  if (error) {
    return (
      <section className="glass space-y-2 p-3">
        <h3 className="text-sm font-semibold text-fg">自动交易状态总览</h3>
        <p className="text-xs text-warn">本地执行数据读取失败：{error}</p>
        <p className="text-[10px] text-mute">为避免误报，读取失败时不显示估算余额或订单状态。</p>
      </section>
    );
  }

  if (!snapshot) {
    return (
      <section className="glass space-y-2 p-3" aria-live="polite">
        <h3 className="text-sm font-semibold text-fg">自动交易状态总览</h3>
        <p className="text-xs text-mute">正在读取本地执行记录…</p>
      </section>
    );
  }

  const openBuys = snapshot.buys.filter((item) =>
    item.status === "pending" || item.status === "partially_filled" || item.status === "reconcile_required"
  );
  const buyReviews = snapshot.buys.filter((item) => item.status === "reconcile_required");
  const openSells = snapshot.sells.filter((item) =>
    item.status === "pending" || item.status === "reconcile_required"
  );
  const sellReviews = snapshot.sells.filter((item) => item.status === "reconcile_required");
  const activeReservations = snapshot.reservations.filter((item) => item.status === "active");
  const reservedUsdt = activeReservations.reduce((sum, item) => sum + Math.max(0, item.reservedUsdt), 0);
  const notificationIssues = snapshot.notifications.filter((item) =>
    item.status === "failed" || item.status === "pending" || item.status === "sending"
  );
  const reviewCount = buyReviews.length + sellReviews.length;

  return (
    <section className="glass space-y-3 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">自动交易状态总览</h3>
          <p className="mt-0.5 text-[10px] text-mute">只读统计本浏览器已保存的队列、资金预留和通知记录，不会触发交易。</p>
        </div>
        <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-sub">本地记录</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="待买订单" value={openBuys.length} detail={`其中需对账 ${buyReviews.length} 笔`} warning={buyReviews.length > 0} />
        <Metric label="待卖事件" value={openSells.length} detail={`其中需对账 ${sellReviews.length} 笔`} warning={sellReviews.length > 0} />
        <Metric label="活动资金预留" value={`$${money(reservedUsdt)}`} detail={`${activeReservations.length} 笔订单占用`} />
        <Metric label="通知待处理" value={notificationIssues.length} detail={`总成交通知 ${snapshot.notifications.length} 条`} warning={notificationIssues.some((item) => item.status === "failed")} />
      </div>
      {reviewCount > 0 ? (
        <div className="rounded-lg border border-warn/40 bg-warn/5 p-2.5">
          <p className="text-xs font-medium text-warn">有 {reviewCount} 笔订单需要对账或人工检查</p>
          <ul className="mt-1 space-y-0.5 text-[10px] text-sub">
            {buyReviews.map((item) => <li key={item.id}>{item.symbol} 买入 · {item.strategyLabel} · {item.lastError || "等待核对"}</li>)}
            {sellReviews.map((item) => <li key={item.eventKey}>{item.symbol} 卖出 · {item.kind} · {item.lastError || "等待核对"}</li>)}
          </ul>
          <p className="mt-1 text-[10px] text-mute">请在下方买入队列或待卖事件中查看详情。此处不会自动释放资金或重试下单。</p>
        </div>
      ) : (
        <p className="text-[10px] text-mute">当前没有标记为「需人工对账」的买卖订单。</p>
      )}
      <p className="text-[10px] text-mute">资金预留仅是本浏览器的本地执行保护，不代表 Binance 账户余额冻结；换设备或清理浏览器数据后，本地记录不会自动同步。</p>
    </section>
  );
}
