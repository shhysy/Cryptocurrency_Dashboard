"use client";

import { useCallback, useEffect, useState } from "react";
import Balances from "./Balances";
import CoinCardView from "./CoinCard";
import CoinCardCompact from "./CoinCardCompact";
import Hero from "./Hero";
import { useFit } from "./hooks";
import Overview, { Donut, EquityChart, SummaryStrip } from "./Overview";
import StrategyInfo from "./StrategyInfo";
import ScoreToast from "./ScoreToast";
import ThemeToggle from "./ThemeToggle";
import Timeline from "./Timeline";
import type { DashboardData } from "@/lib/types";
import { dateTime } from "@/lib/format";

const SCENARIOS: [string, string][] = [
  ["none", "😴 不宜操作"],
  ["accumulate", "🟢 适合买入"],
  ["strong", "🔥 强烈买入"],
  ["sell", "🔴 建议卖出"],
];

type Tab = "trades" | "balance" | "strategy";
const TABS: [Tab, string][] = [
  ["trades", "买入记录"],
  ["balance", "账户余额"],
  ["strategy", "策略说明"],
];

/** 抄底优先：可买 > 可卖 > 暂缓 > 观望；同档按机会指数降序。 */
function sortCoinsForSignal<T extends { signal: { score: number; tag: string; action: { side: string } } }>(coins: T[]): T[] {
  const rank = (c: T) => {
    const side = c.signal.action.side;
    if (side === "buy") return 0;
    if (side === "sell") return 1;
    if (c.signal.tag === "暂缓") return 2;
    return 3;
  };
  return [...coins].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return b.signal.score - a.signal.score;
  });
}

/** 无持仓时右侧用机会条填空，避免最右侧大片空白。 */
function ScoreRadar({ coins }: { coins: DashboardData["coins"] }) {
  const sorted = [...coins].sort((a, b) => b.signal.score - a.signal.score);
  const line = 30;
  return (
    <ul className="space-y-1.5">
      {sorted.map((c) => {
        const s = c.signal.score;
        const w = Math.min(100, (s / 90) * 100);
        return (
          <li key={c.symbol} className="flex items-center gap-2 text-[11px]">
            <a href={`#coin-${c.symbol}`} className="w-10 shrink-0 font-medium text-fg hover:text-gold">
              {c.symbol}
            </a>
            <div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-track">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${w}%`,
                  background:
                    s >= line
                      ? "linear-gradient(90deg, var(--c-up), var(--c-gold))"
                      : "linear-gradient(90deg, var(--c-calm), var(--c-mute))",
                }}
              />
              <i className="absolute top-0 h-full w-px bg-gold/60" style={{ left: `${(line / 90) * 100}%` }} />
            </div>
            <span className="num w-8 shrink-0 text-right text-sub">{s}</span>
          </li>
        );
      })}
    </ul>
  );
}

function MarketSnap({ data }: { data: DashboardData }) {
  const fg = data.market.fearGreed;
  const btc = data.market.btcState;
  const btcLabel = btc === "bear" ? "熊市" : btc === "bull" ? "牛市" : btc === "transition" ? "过渡" : "—";
  const top = [...data.coins].sort((a, b) => b.signal.score - a.signal.score)[0];
  return (
    <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
      <div className="rounded-lg border border-line bg-soft/50 px-1.5 py-2">
        <p className="text-mute">恐慌指数</p>
        <p className="num mt-0.5 text-base font-semibold text-fg">{fg ?? "—"}</p>
      </div>
      <div className="rounded-lg border border-line bg-soft/50 px-1.5 py-2">
        <p className="text-mute">BTC</p>
        <p className="mt-0.5 text-base font-semibold text-fg">{btcLabel}</p>
      </div>
      <div className="rounded-lg border border-line bg-soft/50 px-1.5 py-2">
        <p className="text-mute">最高分</p>
        <p className="num mt-0.5 text-base font-semibold text-fg">
          {top ? top.signal.score : "—"}
          {top ? <span className="text-[10px] font-normal text-mute"> {top.symbol}</span> : null}
        </p>
      </div>
    </div>
  );
}

export default function Dashboard({ initial }: { initial: DashboardData }) {
  const [data, setData] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("trades");
  const fit = useFit();
  const scenario = data.source === "mock" ? data.scenario : undefined;

  const refresh = useCallback(async (sc?: string) => {
    try {
      const direct = process.env.NEXT_PUBLIC_DIRECT_BINANCE === "1" && typeof window !== "undefined";
      if (direct && !sc) {
        const { getBrowserDashboard } = await import("@/lib/service.browser");
        setData(await getBrowserDashboard());
        setErr(null);
        return;
      }
      const res = await fetch(`/api/dashboard${sc ? `?scenario=${sc}` : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
      setErr(null);
    } catch (e) {
      setErr(`刷新失败：${e instanceof Error ? e.message.slice(0, 100) : "未知错误"}`);
    }
  }, []);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DIRECT_BINANCE === "1" && data.source === "mock") {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (data.source !== "binance") return;
    const id = setInterval(() => refresh(), 60_000);
    return () => clearInterval(id);
  }, [data.source, refresh]);

  const stale = data.stale || err;
  const symbols = data.coins.map((c) => c.symbol);
  const coinsSorted = sortCoinsForSignal(data.coins);

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

  const banner = err ? (
    <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{err}</div>
  ) : data.stale ? (
    <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
      部分数据过期，显示的是上次成功缓存。{data.staleReasons.join("；")}
    </div>
  ) : null;

  const notes =
    data.notes.length > 0 ? (
      <ul className="space-y-1 text-xs text-mute">
        {data.notes.map((n) => (
          <li key={n}>· {n}</li>
        ))}
      </ul>
    ) : null;

  const footer = (
    <footer className="text-center text-[11px] leading-relaxed text-mute">
      信号仅供参考，不构成投资建议。加密货币波动剧烈，请控制仓位，只投入可以长期放着的资金。
    </footer>
  );

  if (fit) {
    return (
      <main className="mx-auto flex h-dvh w-full max-w-[1800px] flex-col gap-2 overflow-hidden px-4 py-2.5 lg:px-6">
        {header}
        {banner}
        <ScoreToast data={data} />
        <Hero data={data} />
        <SummaryStrip data={data} />

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(320px,26%)] gap-2">
          <section
            aria-label="持仓卡片"
            className="grid min-h-0 gap-2"
            style={{
              gridTemplateColumns: `repeat(${data.coins.length > 6 ? 4 : data.coins.length > 4 ? 3 : 2}, minmax(0, 1fr))`,
              gridAutoRows: "minmax(0, 1fr)",
            }}
          >
            {coinsSorted.map((c) => (
              <CoinCardCompact key={c.symbol} coin={c} />
            ))}
          </section>

          <aside className="flex min-h-0 flex-col gap-2">
            <div className="glass shrink-0 p-3">
              {data.equityCurve.length >= 2 ? (
                <>
                  <p className="mb-1 text-[11px] text-sub">资产增长曲线 · 按周</p>
                  <EquityChart data={data.equityCurve} height={110} />
                </>
              ) : (
                <>
                  <p className="mb-2 text-[11px] text-sub">市场快照</p>
                  <MarketSnap data={data} />
                  <p className="mt-2 text-[10px] leading-relaxed text-mute">暂无持仓曲线。开启账户或有买入记录后这里会显示资产增长。</p>
                </>
              )}
            </div>
            <div className="glass shrink-0 p-3">
              {data.allocation.length > 0 ? (
                <>
                  <p className="mb-1.5 text-[11px] text-sub">持仓占比</p>
                  <Donut items={data.allocation} compact />
                </>
              ) : (
                <>
                  <p className="mb-1.5 text-[11px] text-sub">机会指数 · 全市场</p>
                  <ScoreRadar coins={data.coins} />
                  <p className="mt-2 text-[10px] text-mute">观察线 30 分 · 点击币种跳到卡片</p>
                </>
              )}
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

  return (
    <main className="mx-auto w-full max-w-[1480px] space-y-5 px-4 pb-16 pt-5 sm:px-6 sm:pt-8 lg:px-10">
      {header}
      {banner}
      <ScoreToast data={data} />
      <Hero data={data} />
      <Overview data={data} />
      <Balances data={data} />

      <section aria-label="持仓卡片">
        <h2 className="mb-3 px-1 text-sm font-medium tracking-wide text-sub">我的持仓</h2>
        <div className="grid gap-4 md:grid-cols-2 min-[1280px]:grid-cols-3">
          {coinsSorted.map((c) => (
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
