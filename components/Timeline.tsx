"use client";

import { useState } from "react";
import { POS_COLOR, POS_LABEL } from "./CoinCard";
import type { TradeRow } from "@/lib/types";
import { date, pct, price, qty, tone, usd } from "@/lib/format";

/** bare = 嵌在侧边面板里（窄栏）：不带外框，且固定使用窄屏排版。 */
export default function Timeline({ trades, symbols, bare = false }: { trades: TradeRow[]; symbols: string[]; bare?: boolean }) {
  const [filter, setFilter] = useState<string>("ALL");
  const rows = filter === "ALL" ? trades : trades.filter((t) => t.symbol === filter);
  const w = (c: string) => (bare ? "" : c); // 宽屏专用类，窄栏里不用

  return (
    <section className={bare ? "" : "glass fade-in p-5 sm:p-8"} aria-label="买入记录">
      <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
   {!bare && <h2 className="text-lg font-semibold">买入记录</h2>}
          <p className={`text-xs text-mute ${bare ? "" : "mt-1"}`}>
     颜色表示买入时价格在近 52 周区间的位置：<span className="text-up">低位</span> ≤ 33%，<span className="text-warn">高位</span> ≥ 66%
   </p>
 </div>
        <div className="flex flex-wrap gap-1.5" role="tablist">
   {["ALL", ...symbols].map((s) => (
     <button
       key={s}
role="tab"
aria-selected={filter === s}
       onClick={() => setFilter(s)}
       className={`rounded-full border px-3 py-1 text-xs transition ${
  filter === s ? "border-gold/60 bg-gold/10 text-gold" : "border-line text-mute hover:text-fg"
       }`}
     >
{s === "ALL" ? "全部" : s}
     </button>
   ))}
        </div>
      </div>

      <ol className={bare ? "mt-3 space-y-1.5" : "mt-6 space-y-2"}>
        {rows.length === 0 && <li className="py-8 text-center text-sm text-mute">暂无买入记录</li>}
        {rows.map((t) => (
   <li
     key={t.id}
            className={`grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 rounded-xl border border-line bg-soft transition hover:bg-soft-2 ${
bare ? "px-3 py-2" : "px-4 py-3"
     } ${w("sm:grid-cols-[auto_90px_1fr_1fr_1fr_auto]")}`}
     style={{ borderLeft: `3px solid ${POS_COLOR[t.position]}` }}
   >
     <span className={`num text-xs text-mute ${w("sm:order-none")}`}>{date(t.time)}</span>
            <span className={`font-semibold ${w("sm:order-none")}`}>
       {t.symbol}
       {t.source === "manual" && <em className="ml-1.5 align-middle text-[10px] font-normal not-italic text-mute">导入</em>}
     </span>
     <span className={`num text-right text-sm font-semibold ${w("sm:order-last sm:min-w-[92px]")} ${tone(t.pnlPct)}`}>
       {pct(t.pnlPct, 1)}
       <span className="block text-[11px] font-normal opacity-70">{t.pnlUsdt >= 0 ? "+" : "-"}{usd(Math.abs(t.pnlUsdt), 0)}</span>
     </span>
     <span className={`num col-span-3 grid grid-cols-3 gap-2 text-xs text-sub ${w("sm:col-span-3 sm:contents")}`}>
       <span>买入价 <b className="text-fg">{price(t.price)}</b></span>
       <span className={w("sm:text-left")}>数量 <b className="text-fg">{qty(t.qty)}</b></span>
       <span>金额 <b className="text-fg">{usd(t.amount, 0)}</b></span>
     </span>
     <span
       className={`col-span-3 -mt-0.5 text-[11px] ${w("sm:order-last sm:col-span-1 sm:mt-0 sm:hidden")}`}
style={{ color: POS_COLOR[t.position] }}
     >
       {POS_LABEL[t.position]} · 52 周区间 {(t.positionPct * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
