"use client";

import { PriceChart, TAG_STYLE, indicatorItems } from "./CoinCard";
import { useFlash, useSize } from "./hooks";
import type { CoinCard } from "@/lib/types";
import { pct, price as fmtPrice, qty as fmtQty, tone, usd } from "@/lib/format";

const SHORT: [string, string][] = [
  ["周线 ", "周"],
  ["月线 ", "月"],
  ["距 52 周高点", "回撤"],
  ["对周线 MA200", "MA200"],
  ["对月线 MA20", "MA20"],
];
const shorten = (s: string) => SHORT.reduce((acc, [a, b]) => acc.replace(a, b), s);

/**
 * 紧凑版持仓卡片（一屏模式用）。
 * 内容和完整卡片一致：价格、24h、收益、周线图（买入点/成本线/翻倍线）、
 * 持仓数量与市值、距翻倍进度、信号标签、各项指标是否触发。
 * 图表占满剩余高度。卡片高度小于 250px（小屏幕）时进入 dense：
 * 持仓/市值/成本合成一行，距翻倍进度条并成一行，把空间让给图表。
 */
export default function CoinCardCompact({ coin }: { coin: CoinCard }) {
  const [ref, , h] = useSize<HTMLElement>();
  const dense = h > 0 && h < 250;
  const flash = useFlash(coin.price);
  const sig = coin.signal;
  const ret = coin.returnPct;
  const hasPos = coin.qty > 0 && coin.avgCost !== null;
  const items = indicatorItems(sig, coin.price);
  const doubleText = coin.toDoublePct === 0 ? "已达翻倍线" : `还差 ${coin.toDoublePct?.toFixed(1)}%`;

  return (
    <article ref={ref} id={`coin-${coin.symbol}`} className="glass glass-hover fade-in flex min-h-0 flex-col p-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div
     className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-ink"
     style={{ background: `linear-gradient(135deg, ${coin.color}, ${coin.color}99)` }}
     aria-hidden
   >
     {coin.symbol.slice(0, 3)}
   </div>
          <div className="min-w-0 leading-tight">
     <h3 className="truncate text-sm font-semibold">{coin.symbol}</h3>
     <p className="truncate text-[10px] text-mute">{coin.name}</p>
   </div>
 </div>
        <div className="text-right leading-tight">
   <p className={`num rounded px-1 text-sm font-semibold ${flash}`}>{fmtPrice(coin.price)}</p>
   <p className={`num text-[10px] ${tone(coin.change24h)}`}>24h {pct(coin.change24h, 2)}</p>
 </div>
      </header>

      <div className="mt-1 flex items-center justify-between gap-2">
        {hasPos && ret !== null ? (
   <p className={`num font-extrabold leading-none ${dense ? "text-xl" : "text-2xl"} ${tone(ret)}`}>
     {pct(ret, 1)}
     <span className="ml-1 text-[10px] font-normal text-mute">相对成本</span>
   </p>
        ) : (
   <p className="text-base font-semibold text-mute">未持仓</p>
 )}
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${TAG_STYLE[sig.tag]}`}>{sig.tag}</span>
      </div>

      <div className="mt-1 min-h-[48px] flex-1">
        <PriceChart coin={coin} fill />
      </div>

      {dense ? (
 <p className="num mt-1 flex justify-between gap-1 text-[10px] text-sub">
   <span><span className="text-mute">持仓</span> {fmtQty(coin.qty)}</span>
   <span><span className="text-mute">市值</span> {usd(coin.marketValue, 0)}</span>
   <span><span className="text-mute">成本</span> {coin.avgCost ? fmtPrice(coin.avgCost) : "—"}</span>
 </p>
      ) : (
        <div className="mt-1 grid grid-cols-3 gap-2 text-[10px]">
   <div>
     <p className="text-mute">持仓</p>
     <p className="num text-fg">{fmtQty(coin.qty)}</p>
   </div>
   <div>
     <p className="text-mute">市值</p>
     <p className="num text-fg">{usd(coin.marketValue, 0)}</p>
   </div>
   <div>
     <p className="text-mute">平均成本</p>
     <p className="num text-fg">{coin.avgCost ? fmtPrice(coin.avgCost) : "—"}</p>
   </div>
        </div>
      )}

      {hasPos && (
 <div className={dense ? "mt-1 flex items-center gap-2 text-[10px] text-mute" : "mt-1.5"}>
   {dense ? <span className="shrink-0">距翻倍</span> : (
     <div className="mb-0.5 flex justify-between text-[10px] text-mute">
       <span>距翻倍</span>
       <span className={coin.toDoublePct === 0 ? "text-gold" : ""}>{doubleText}</span>
     </div>
   )}
   <div className="h-1 flex-1 overflow-hidden rounded-full bg-track">
     <div
       className="h-full rounded-full"
       style={{ width: `${Math.max(2, coin.doubleProgress * 100)}%`, background: "linear-gradient(90deg,var(--c-up),var(--c-gold))" }}
     />
   </div>
   {dense && <span className={`shrink-0 ${coin.toDoublePct === 0 ? "text-gold" : ""}`}>{doubleText}</span>}
 </div>
      )}

      <div className="mt-1 flex items-start justify-between gap-2 border-t border-line pt-1 text-[10px]">
        <span className="shrink-0 text-mute">
   机会 <b className="num text-xs text-fg">{sig.score}</b>
        </span>
        <span className="flex min-w-0 flex-wrap justify-end gap-x-2 gap-y-0">
          {items.map((it) => (
     <span key={it.label} title={`${it.label} ${it.hint}`} className={`num whitespace-nowrap ${it.hit ? "font-semibold text-up" : "text-sub"}`}>
       <span className="text-mute">{shorten(it.label)}</span> {it.value}
{it.hit && "✓"}
     </span>
   ))}
 </span>
      </div>
    </article>
  );
}
