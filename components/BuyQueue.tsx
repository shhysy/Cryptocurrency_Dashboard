"use client";

import { useEffect, useRef, useState } from "react";
import type { DashboardData } from "@/lib/types";
import type { QueuedBuyOrder } from "@/lib/execution/types";
import { listBuyOrders, listEarnRedemptionIntents } from "@/lib/execution/store.browser";
import { downloadQueuedOrdersCsv } from "@/lib/execution/csv";
import { prepareQueuedBuyDryRun, type BuyDryRunResult } from "@/lib/execution/binance-order.browser";
import { LIVE_SPOT_ORDER_SUBMISSION_ENABLED } from "@/lib/binance.browser";
import { submitQueuedBuyOrder } from "@/lib/execution/buy-order-submit.browser";
import { syncBuyOrderFromBinance } from "@/lib/execution/sync-buy-order.browser";
import { prepareQueuedBuyEarnRedemption, reconcileEarnRedemptionIntent } from "@/lib/execution/earn-redemption.browser";
import type { BuyFundingPlan } from "@/lib/execution/wallet-funds";
import type { EarnRedemptionIntent } from "@/lib/execution/earn-redemption";
import { strategyConfig } from "@/strategy.config";

const EARN_REDEMPTION_STATUS: Record<EarnRedemptionIntent["status"], string> = {
  planned: "待赎回（未提交）",
  submitting: "正在提交",
  submitted: "已提交",
  redeeming: "赎回处理中",
  credited: "已到账",
  reconcile_required: "需人工核对",
  failed: "赎回失败",
};

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

const qty = (value: number) => value.toPrecision(8).replace(/\.?0+$/, "");

export default function BuyQueue({ data, refreshKey }: { data: DashboardData; refreshKey: number }) {
  const [orders, setOrders] = useState<QueuedBuyOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<Record<string, boolean>>({});
  const [previews, setPreviews] = useState<Record<string, BuyDryRunResult>>({});
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});
  const [fundingLoading, setFundingLoading] = useState<Record<string, boolean>>({});
  const [fundingPlans, setFundingPlans] = useState<Record<string, { plan: BuyFundingPlan | null; intents: EarnRedemptionIntent[] }>>({});
  const [fundingErrors, setFundingErrors] = useState<Record<string, string>>({});
  const [reconcileLoading, setReconcileLoading] = useState<Record<string, boolean>>({});
  const [reconcileMessages, setReconcileMessages] = useState<Record<string, string>>({});
  const [buySubmitLoading, setBuySubmitLoading] = useState<Record<string, boolean>>({});
  const [buySubmitMessages, setBuySubmitMessages] = useState<Record<string, string>>({});
  const [buySyncLoading, setBuySyncLoading] = useState<Record<string, boolean>>({});
  const [buySyncMessages, setBuySyncMessages] = useState<Record<string, string>>({});
  const buySyncInFlight = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    setPreviews({});
    setPreviewErrors({});
    setPreviewLoading({});
    setFundingLoading({});
    setFundingPlans({});
    setFundingErrors({});
    setReconcileLoading({});
    setReconcileMessages({});
    setBuySubmitLoading({});
    setBuySubmitMessages({});
    setBuySyncLoading({});
    setBuySyncMessages({});
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
  }, [data, refreshKey]);

  const runDryRun = async (order: QueuedBuyOrder, remainingCapUsdt: number) => {
    setPreviewLoading((current) => ({ ...current, [order.id]: true }));
    setPreviewErrors((current) => ({ ...current, [order.id]: "" }));
    try {
      const result = await prepareQueuedBuyDryRun(order, remainingCapUsdt);
      setPreviews((current) => ({ ...current, [order.id]: result }));
    } catch (e) {
      setPreviewErrors((current) => ({
        ...current,
        [order.id]: e instanceof Error ? e.message : "买入预检失败",
      }));
    } finally {
      setPreviewLoading((current) => ({ ...current, [order.id]: false }));
    }
  };

  const planFunding = async (order: QueuedBuyOrder) => {
    setFundingLoading((current) => ({ ...current, [order.id]: true }));
    setFundingErrors((current) => ({ ...current, [order.id]: "" }));
    try {
      const result = await prepareQueuedBuyEarnRedemption({
        orderId: order.id,
        requestedUsdt: order.remainingUsdt,
        symbol: order.symbol,
        quoteAsset: order.quoteAsset,
      });
      setFundingPlans((current) => ({
        ...current,
        [order.id]: { plan: result.plan, intents: result.intents },
      }));
    } catch (e) {
      setFundingErrors((current) => ({
        ...current,
        [order.id]: e instanceof Error ? e.message : "资金来源规划失败",
      }));
    } finally {
      setFundingLoading((current) => ({ ...current, [order.id]: false }));
    }
  };

  const reconcileEarnIntent = async (orderId: string, intent: EarnRedemptionIntent) => {
    setReconcileLoading((current) => ({ ...current, [intent.id]: true }));
    setReconcileMessages((current) => ({ ...current, [intent.id]: "" }));
    try {
      const result = await reconcileEarnRedemptionIntent(intent);
      const latest = await listEarnRedemptionIntents(orderId);
      setFundingPlans((current) => ({
        ...current,
        [orderId]: {
          plan: current[orderId]?.plan ?? null,
          intents: latest,
        },
      }));
      setReconcileMessages((current) => ({ ...current, [intent.id]: result.reason }));
    } catch (e) {
      setReconcileMessages((current) => ({
        ...current,
        [intent.id]: e instanceof Error ? e.message : "赎回核对失败",
      }));
    } finally {
      setReconcileLoading((current) => ({ ...current, [intent.id]: false }));
    }
  };

  const submitBuy = async (order: QueuedBuyOrder, remainingCapUsdt: number) => {
    setBuySubmitLoading((current) => ({ ...current, [order.id]: true }));
    setBuySubmitMessages((current) => ({ ...current, [order.id]: "" }));
    try {
      const result = await submitQueuedBuyOrder(order.id, remainingCapUsdt);
      setBuySubmitMessages((current) => ({
        ...current,
        [order.id]: result.reason ?? (result.submitted ? "订单已提交，等待对账" : "订单未提交"),
      }));
      setOrders(await listBuyOrders());
    } catch (e) {
      setBuySubmitMessages((current) => ({
        ...current,
        [order.id]: e instanceof Error ? e.message : "买单提交失败",
      }));
    } finally {
      setBuySubmitLoading((current) => ({ ...current, [order.id]: false }));
    }
  };

  const syncBuy = async (order: QueuedBuyOrder) => {
    if (buySyncInFlight.current.has(order.id)) return;
    buySyncInFlight.current.add(order.id);
    setBuySyncLoading((current) => ({ ...current, [order.id]: true }));
    setBuySyncMessages((current) => ({ ...current, [order.id]: "" }));
    try {
      const attempt = Math.max(0, order.attemptCount - 1);
      const result = await syncBuyOrderFromBinance(order.id, attempt);
      setBuySyncMessages((current) => ({
        ...current,
        [order.id]: result.reason ?? `对账结果：${result.action}；新增成交 ${result.newlyRecordedFills} 笔`,
      }));
      setOrders(await listBuyOrders());
    } catch (e) {
      setBuySyncMessages((current) => ({
        ...current,
        [order.id]: e instanceof Error ? e.message : "买单对账失败",
      }));
    } finally {
      buySyncInFlight.current.delete(order.id);
      setBuySyncLoading((current) => ({ ...current, [order.id]: false }));
    }
  };

  const openCount = orders.filter((order) =>
    order.status === "pending" || order.status === "partially_filled" || order.status === "reconcile_required"
  ).length;

  return (
    <section className="glass space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">待买队列</h3>
          <p className="mt-0.5 text-[11px] text-mute">策略信号已入队；资金规划只读 Binance 并做本地资金预留，不会赎回理财或提交订单。</p>
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
        <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
          {orders.map((order) => {
            const coin = data.coins.find((item) =>
              item.symbol === order.symbol || item.symbol + order.quoteAsset === order.symbol
            );
            const capUsdt = coin ? strategyConfig.profiles[coin.signal.group].capUsdt : 0;
            const remainingCapUsdt = Math.max(0, capUsdt - (coin?.invested ?? 0));
            const canPreview = Boolean(
              coin && data.source === "binance" && !data.stale && data.market.accountKnown &&
              (order.status === "pending" || order.status === "partially_filled")
            );
            const preview = previews[order.id];

            return (
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
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-mute">单币剩余额度 {money(remainingCapUsdt)} USDT</span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={!canPreview || fundingLoading[order.id]}
                      onClick={() => void planFunding(order)}
                      className="rounded-full border border-line px-3 py-1 text-[10px] text-sub transition hover:text-fg disabled:opacity-40"
                    >
                      {fundingLoading[order.id] ? "读取中…" : "资金来源规划"}
                    </button>
                    <button
                      type="button"
                      disabled={!canPreview || previewLoading[order.id]}
                      onClick={() => void runDryRun(order, remainingCapUsdt)}
                      className="rounded-full border border-gold/40 px-3 py-1 text-[10px] text-gold transition hover:bg-gold/10 disabled:opacity-40"
                    >
                      {previewLoading[order.id] ? "预检中…" : "只读预检"}
                    </button>
                    <button
                      type="button"
                      disabled={!LIVE_SPOT_ORDER_SUBMISSION_ENABLED || !canPreview || !preview?.ok || buySubmitLoading[order.id]}
                      onClick={() => void submitBuy(order, remainingCapUsdt)}
                      className="rounded-full border border-line px-3 py-1 text-[10px] text-sub transition hover:text-fg disabled:opacity-40"
                      title="实盘买入开关关闭时不可用"
                    >
                      {buySubmitLoading[order.id] ? "提交中…" : LIVE_SPOT_ORDER_SUBMISSION_ENABLED ? "执行买入" : "实盘买入未启用"}
                    </button>
                  </div>
                </div>
                {fundingPlans[order.id] ? (
                  <div className="mt-2 rounded-lg border border-line bg-panel/70 p-2 text-[11px]">
                    <p className="font-medium text-fg">Spot 优先 · Simple Earn 活期补足</p>
                    {fundingPlans[order.id].plan ? (
                      <>
                        <p className="mt-1 text-sub">现货本地预留：{money(fundingPlans[order.id].plan!.spotToUseUsdt)} USDT</p>
                        <p className="text-sub">活期理财计划赎回：{money(fundingPlans[order.id].plan!.flexibleEarnToRedeemUsdt)} USDT</p>
                        <p className="text-sub">仍未满足：{money(fundingPlans[order.id].plan!.unfundedUsdt)} USDT</p>
                        <p className="text-[10px] text-mute">本地预留只防止本项目重复分配，不会冻结 Binance 账户资金。</p>
                      </>
                    ) : (
                      <p className="mt-1 text-sub">该订单已有赎回意图，沿用现有记录，不重复生成赎回计划。</p>
                    )}
                    {fundingPlans[order.id].intents.length > 0 ? (
                      <div className="mt-1 space-y-1">
                        <p className="text-sub">本地赎回意图状态（不会自动重发）：</p>
                        {fundingPlans[order.id].intents.map((intent) => (
                          <div key={intent.id} className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sub">
                              {intent.productId} · {money(intent.amountUsdt)} USDT · {EARN_REDEMPTION_STATUS[intent.status]}
                            </p>
                            {intent.status !== "planned" && intent.status !== "credited" && intent.status !== "failed" ? (
                              <button
                                type="button"
                                disabled={Boolean(reconcileLoading[intent.id])}
                                onClick={() => void reconcileEarnIntent(order.id, intent)}
                                className="rounded-full border border-line px-2 py-0.5 text-[10px] text-sub hover:text-fg disabled:opacity-40"
                              >
                                {reconcileLoading[intent.id] ? "核对中…" : "核对赎回"}
                              </button>
                            ) : null}
                            {reconcileMessages[intent.id] ? (
                              <p className="w-full text-[10px] text-mute">{reconcileMessages[intent.id]}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {fundingErrors[order.id] ? <p className="mt-2 text-[10px] text-warn">{fundingErrors[order.id]}</p> : null}
                {preview ? (
                  <div className="mt-2 rounded-lg border border-line bg-panel/70 p-2 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-fg">DRY_RUN · 未提交</span>
                      <span className={preview.ok ? "text-up" : "text-warn"}>{preview.ok ? "预检通过" : "暂不可执行"}</span>
                    </div>
                    <p className="mt-1 text-sub">USDT free：{money(preview.freeUsdt)} · 其他订单预留：{money(preview.otherReservedUsdt)} USDT</p>
                    <p className="text-sub">未预留余额：{money(preview.unreservedFreeUsdt)} · 本次可执行：{money(preview.executableUsdt)} USDT</p>
                    <p className="text-sub">预计数量：{qty(preview.estimatedBaseQty)} {order.symbol} · 计划剩余：{money(preview.remainingPlannedUsdt)} USDT</p>
                    {preview.reason ? <p className="mt-1 text-warn">{preview.reason}</p> : null}
                  </div>
                ) : null}
                {previewErrors[order.id] ? <p className="mt-2 text-[10px] text-warn">{previewErrors[order.id]}</p> : null}
                {buySubmitMessages[order.id] ? <p className="mt-2 text-[10px] text-mute">{buySubmitMessages[order.id]}</p> : null}
                {order.status === "reconcile_required" && order.attemptCount > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={Boolean(buySyncLoading[order.id])}
                      onClick={() => void syncBuy(order)}
                      className="rounded-full border border-gold/40 px-3 py-1 text-[10px] text-gold hover:bg-gold/10 disabled:opacity-40"
                    >
                      {buySyncLoading[order.id] ? "对账中…" : "核对 Binance 买单"}
                    </button>
                    {buySyncMessages[order.id] ? <p className="text-[10px] text-mute">{buySyncMessages[order.id]}</p> : null}
                  </div>
                ) : null}
                {order.lastError ? <p className="mt-2 text-[10px] text-warn">{order.lastError}</p> : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
