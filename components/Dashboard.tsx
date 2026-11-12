"use client";

import { useCallback, useEffect, useState } from "react";
import Balances from "./Balances";
import CoinCardView from "./CoinCard";
import CoinCardCompact from "./CoinCardCompact";
import Hero from "./Hero";
import { useFit } from "./hooks";
import Overview, { Donut, EquityChart, SummaryStrip } from "./Overview";
import StrategyInfo from "./StrategyInfo";
import ThemeToggle from "./ThemeToggle";
import Timeline from "./Timeline";
import type { DashboardData } from "@/lib/types";
import { dateTime } from "@/lib/format";

const SCENARIOS: [string, string][] = [
  ["none", "😴 不宜操作"],
  ["accumulate", "🟢 适合加仓"],
  ["strong", "🔥 强烈买入"],
  ["risk", "🟡 风险暂停"],
  ["sell", "🔴 卖出条件"],
];

type Tab = "trades" | "balance" | "strategy";
const TABS: [Tab, string][] = [
  ["trades", "买入记录"],
  ["balance", "账户余额"],
  ["strategy", "策略说明"],
];

export default function Dashboard({ initial }: { initial: DashboardData }) {
  const [data, setData] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("trades");
  const fit = useFit();
  const scenario = data.source === "mock" ? data.scenario : undefined;

  const refresh = useCallback(async (sc?: string) => {
    try {
      const res = await fetch(`/api/dashboard${sc ? `?scenario=${sc}` : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
      setErr(null);
    } catch {
      setErr("刷新失败，当前显示的是上次数据");
    }
  }, []);

  // 真实数据每分钟刷新一次（服务端另有缓存，不会打爆币安限流）
  useEffect(() => {
    if (data.source !== "binance") return;
    const id = setInterval(() => refresh(), 60_000);
    return () => clearInterval(id);
  }, [data.source, refresh]);

  const stale = data.stale || err;
  const symbols = data.coins.map((c) => c.symbol);

  const header = (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs text-mute">
      <span className="tracking-[0.25em]">
        <b className="text-gold">◆</b> 长期持有 · 信号看板 <em className="ml-1 not-italic opacity-60">只读</em>
      </span>
      <span className="num flex flex-wrap items-center gap-2">
        {data.source === "mock" && (
          <span className="flex flex-wrap items-center gap-1">
     {SCENARIOS.map(([k, label]) => (
       <button
         key={k}
  onClick={() => refresh(k)}
         className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
    scenario === k ? "border-gold/60 bg-gold/10 text-gold" : "border-line hover:text-fg"
         }`}
       >
         {label}
       </button>
     ))}
          </span>
 )}
        <i className={`inline-block h-1.5 w-1.5 rounded-full ${stale ? "bg-warn" : "bg-up"}`} />
        数据更新时间 {dateTime(data.updatedAt)}
        {data.source === "mock" && <span className="rounded border border-gold/40 px-1.5 text-gold">示例数据</span>}
        <ThemeToggle />
      </span>
    </header>
  );

  const banner = stale && (
    <div className="shrink-0 rounded-xl border border-warn/30 bg-warn/10 px-4 py-1.5 text-xs text-warn" role="status">
      {err ?? "接口暂时不可用，显示的是上次缓存数据"}（更新于 {dateTime(data.updatedAt)}）
    </div>
  );

  const notes = data.notes.length > 0 && (
    <div className="space-y-0.5 rounded-xl border border-line px-3 py-1.5 text-[11px] leading-snug text-mute">
      {data.notes.map((n) => (
        <p key={n}>⚠ {n}</p>
      ))}
    </div>
  );

  const footer = (
    <footer className="shrink-0 px-2 text-center text-[11px] leading-relaxed text-mute">
      信号仅供参考，不构成投资建议。加密货币波动剧烈，请控制仓位，只投入可以长期放着的资金。
    </footer>
  );

  /* ================= 一屏模式（桌面，高度够用） ================= */
  if (fit) {
    return (
      <main className="mx-auto flex h-dvh w-full max-w-[1800px] flex-col gap-2 overflow-hidden px-4 py-2.5 lg:px-6">
 {header}
        {banner}
        <Hero data={data} />
        <SummaryStrip data={data} />

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(320px,26%)] gap-2">
          {/* 左：持仓卡片，自动按币种数量排列 */}
          <section
     aria-label="持仓卡片"
     className="grid min-h-0 gap-2"
     style={{
       gridTemplateColumns: `repeat(${data.coins.length > 6 ? 4 : data.coins.length > 4 ? 3 : 2}, minmax(0, 1fr))`,
       gridAutoRows: "minmax(0, 1fr)",
     }}
   >
     {data.coins.map((c) => (
<CoinCardCompact key={c.symbol} coin={c} />
     ))}
   </section>

          {/* 右：曲线、占比、以及可切换的面板 */}
          <aside className="flex min-h-0 flex-col gap-2">
            <div className="glass shrink-0 p-3">
       <p className="mb-1 text-[11px] text-sub">资产增长曲线 · 按周</p>
       <EquityChart data={data.equityCurve} height={110} />
     </div>
     <div className="glass shrink-0 p-3">
       <p className="mb-1.5 text-[11px] text-sub">持仓占比</p>
<Donut items={data.allocation} compact />
            </div>
     <div className="glass flex min-h-0 flex-1 flex-col p-3">
       <div className="mb-2 flex shrink-0 gap-1" role="tablist">
         {TABS.map(([k, label]) => (
    <button
      key={k}
      role="tab"
      aria-selected={tab === k}
      onClick={() => setTab(k)}
      className={`rounded-full border px-3 py-0.5 text-xs transition ${
        tab === k ? "border-gold/60 bg-gold/10 text-gold" : "border-line text-mute hover:text-fg"
      }`}
    >
      {label}
    </button>
  ))}
</div>
       {/* 内容放不下时，这里出现滚动条 */}
       <div className="min-h-0 flex-1 overflow-y-auto pr-1">
  {tab === "trades" && <Timeline trades={data.trades} symbols={symbols} bare />}
  {tab === "balance" && <Balances data={data} bare />}
  {tab === "strategy" && <StrategyInfo bare />}
       </div>
     </div>
          </aside>
        </div>

        {notes}
        {footer}
      </main>
    );
  }

  /* ================= 普通模式（手机 / 小窗口）：向下滚动 ================= */
  return (
    <main className="mx-auto w-full max-w-[1480px] space-y-5 px-4 pb-16 pt-5 sm:px-6 sm:pt-8 lg:px-10">
      {header}
      {banner}
      <Hero data={data} />
      <Overview data={data} />
      <Balances data={data} />

      <section aria-label="持仓卡片">
        <h2 className="mb-3 px-1 text-sm font-medium tracking-wide text-sub">我的持仓</h2>
        <div className="grid gap-4 md:grid-cols-2 min-[1280px]:grid-cols-3">
   {data.coins.map((c) => (
     <CoinCardView key={c.symbol} coin={c} />
   ))}
 </div>
      </section>

      <Timeline trades={data.trades} symbols={symbols} />
      <StrategyInfo />
      {notes}
      <div className="pt-6">{footer}</div>
    </main>
  );
}
