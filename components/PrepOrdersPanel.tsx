"use client";

import { useCallback, useEffect, useState } from "react";
import type { DashboardData } from "@/lib/types";
import type { PrepPlan } from "@/lib/execution/prep-orders";
import { downloadPrepPlanCsv, prepPlansToCsv } from "@/lib/execution/prep-orders-csv";
import {
  applyReplenishAvgCostToPrepPlan,
  applyTakeProfitToPrepPlan,
  forceInitialPrepPlan,
  getPrepPlan,
  listPrepPlans,
} from "@/lib/execution/prep-store.browser";
import { strategyConfig } from "@/strategy.config";

/**
 * 预备订单：本地「人工计划」与 CSV 导出。
 * 不是交易所挂单，不接入自动下单；自动策略真源仍是成交台账。
 */
export default function PrepOrdersPanel({ data, refreshKey }: { data: DashboardData; refreshKey: number }) {
  const [plans, setPlans] = useState<PrepPlan[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(() => {
    setPlans(listPrepPlans());
  }, []);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  useEffect(() => {
    if (data.source !== "binance") return;
    let changed = false;
    for (const coin of data.coins) {
      if (coin.qty <= 0 || coin.avgCost == null || coin.avgCost <= 0) continue;
      const invested = coin.avgCost * coin.qty;
      if (invested < strategyConfig.headMinUsdt) continue;
      const existing = getPrepPlan(coin.symbol);
      if (!existing) {
        forceInitialPrepPlan(coin.symbol, coin.avgCost, coin.avgCost);
        changed = true;
      } else if (existing.hasTakenProfit && existing.avgCost > 0) {
        const drift = Math.abs(coin.avgCost - existing.avgCost) / existing.avgCost;
        if (drift >= 0.005) {
          applyReplenishAvgCostToPrepPlan(coin.symbol, coin.avgCost);
          changed = true;
        }
      }
    }
    if (changed) reload();
  }, [data, reload]);

  const onGenerateHead = (symbol: string) => {
    const coin = data.coins.find((c) => c.symbol === symbol);
    if (!coin || coin.avgCost == null || coin.avgCost <= 0) {
      setMsg(`${symbol} 无有效均价，无法生成`);
      return;
    }
    forceInitialPrepPlan(symbol, coin.avgCost, coin.avgCost);
    setMsg(`已生成 ${symbol} 人工预备计划（补仓+止盈，非挂单）`);
    reload();
  };

  const onMarkTakeProfit = (symbol: string, tier: number) => {
    const coin = data.coins.find((c) => c.symbol === symbol);
    const plan = getPrepPlan(symbol);
    if (!coin?.avgCost || !plan) {
      setMsg("缺少计划或均价");
      return;
    }
    const done = [
      ...plan.orders.filter((o) => o.kind === "takeProfit" && o.status === "done").map((o) => o.tierIndex),
      tier,
    ];
    applyTakeProfitToPrepPlan(symbol, plan.headPrice, coin.avgCost, [...new Set(done)]);
    setMsg(`${symbol} 已记止盈${tier}：旧补仓关闭，已按均价生成回补并重算止盈（仍为人工计划）`);
    reload();
  };

  const onExportOne = (plan: PrepPlan) => {
    downloadPrepPlanCsv(plan);
  };

  const onExportAll = () => {
    if (!plans.length) return;
    const blob = new Blob(["\uFEFF", prepPlansToCsv(plans)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `预备订单_全部_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="glass space-y-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">预备订单（人工计划）</h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-mute">
            本地人工计划与 CSV 导出工具，<strong className="text-sub">不是</strong>交易所挂单，也
            <strong className="text-sub">不会</strong>自动下单。头仓后可生成补仓/备用金与止盈触发价；点「记止盈」后关闭原头仓补仓，按均价回补并重算止盈。自动策略真源仍是成交台账，与本面板独立。
          </p>
        </div>
        <button
          type="button"
          onClick={onExportAll}
          disabled={!plans.length}
          className="rounded-full border border-line px-3 py-1 text-xs text-sub transition hover:text-fg disabled:opacity-40"
        >
          导出全部 CSV
        </button>
      </div>

      {msg ? <p className="text-[11px] text-gold">{msg}</p> : null}

      <div className="flex flex-wrap gap-2">
        {data.coins.map((c) => (
          <button
            key={c.symbol}
            type="button"
            onClick={() => onGenerateHead(c.symbol)}
            className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-sub hover:border-gold/50 hover:text-gold"
          >
            生成 {c.symbol}
          </button>
        ))}
      </div>

      {plans.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-5 text-center text-xs text-mute">
          暂无人工预备计划。有头仓/持仓后点「生成」，或等待持仓自动生成（仍仅本地，非挂单）。
        </p>
      ) : (
        <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
          {plans.map((plan) => {
            const pending = plan.orders.filter((o) => o.status === "pending");
            const buys = pending.filter((o) => o.side === "BUY");
            const sells = pending.filter((o) => o.side === "SELL");
            return (
              <div key={plan.symbol} className="rounded-lg border border-line bg-soft/40 p-2.5 text-[11px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-fg">{plan.symbol}</span>
                    <span className="ml-2 text-mute">
                      {plan.phase === "initial" ? "人工·初始（头仓锚定）" : "人工·止盈后（均价回补）"}
                      {" · "}均价 {plan.avgCost}
                      {" · "}头仓价 {plan.headPrice}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      className="rounded-full border border-line px-2 py-0.5 text-sub hover:text-fg"
                      onClick={() => onExportOne(plan)}
                    >
                      导出 CSV
                    </button>
                    {[1, 2, 3].map((t) => (
                      <button
                        key={t}
                        type="button"
                        className="rounded-full border border-gold/40 px-2 py-0.5 text-gold hover:bg-gold/10"
                        onClick={() => onMarkTakeProfit(plan.symbol, t)}
                      >
                        记止盈{t}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="mt-1 text-mute">
                  待触发：买 {buys.length} / 卖 {sells.length}（共 {pending.length} 条 pending）
                </p>
                <ul className="mt-1.5 space-y-0.5 text-sub">
                  {pending.slice(0, 8).map((o) => (
                    <li key={o.id} className="flex flex-wrap gap-x-2">
                      <span className={o.side === "BUY" ? "text-up" : "text-down"}>{o.side}</span>
                      <span>{o.label}</span>
                      <span className="num text-mute">@{o.triggerPrice}</span>
                      {o.plannedUsdt != null ? <span>{o.plannedUsdt}U</span> : null}
                      {o.sellRatioOfCycle != null ? (
                        <span>周期仓{(o.sellRatioOfCycle * 100).toFixed(0)}%</span>
                      ) : null}
                    </li>
                  ))}
                  {pending.length > 8 ? <li className="text-mute">…其余见 CSV</li> : null}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
