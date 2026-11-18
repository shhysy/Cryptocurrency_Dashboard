"use client";

import { useCallback, useEffect, useState } from "react";
import Balances from "./Balances";
import BuyQueue from "./BuyQueue";
import SellQueue from "./SellQueue";
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

type Tab = "trades" | "balance" | "strategy" | "queue";
const TABS: [Tab, string][] = [
  ["trades", "买入记录"],
  ["balance", "账户余额"],
  ["strategy", "策略说明"],
  ["queue", "待买队列"],
];

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
  const [directReady, setDirectReady] = useState(false);
  const [queueVersion, setQueueVersion] = useState(0);
  const [tab, setTab] = useState<Tab>("trades");
  const fit = useFit();
  const scenario = data.source === "mock" ? data.scenario : undefined;

  const refresh = useCallback(async (sc?: string) => {
    try {
      const direct = process.env.NEXT_PUBLIC_DIRECT_BINANCE === "1" && typeof window !== "undefined";
      if (direct && !sc) {
        const { getBrowserDashboard } = await import("@/lib/service.browser");
        setData(await getBrowserDashboard());
        setDirectReady(true);
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
    if (process.env.NEXT_PUBLIC_DIRECT_BINANCE === "1") {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fresh Binance BUY signals are queued and SELL signals are reserved as guarded events.
  // Neither path submits an order to the exchange.
  useEffect(() => {
    if (!directReady || data.source !== "binance" || data.stale) return;
    let cancelled = false;
    Promise.all([
      import("@/lib/execution/signal-queue").then(({ enqueueEligibleBuySignals }) => enqueueEligibleBuySignals(data)),
      import("@/lib/execution/sell-signal-queue").then(({ enqueueEligibleSellSignals }) => enqueueEligibleSellSignals(data)),
    ])
      .then(([buy, sell]) => {
        if (!cancelled && buy.created > 0) console.info("[buy-queue] 新增待买策略事件", buy.created);
        if (!cancelled && sell.created > 0) console.info("[sell-queue] 新增待卖策略事件", sell.created);
      })
      .catch((error) => {
        if (!cancelled) console.warn("[strategy-queue]", error);
      })
      .finally(() => {
        if (!cancelled) setQueueVersion((version) => version + 1);
      });
    return () => { cancelled = true; };
  }, [data, directReady]);

  useEffect(() => {
    if (data.source !== "binance") return;
    const id = setInterval(() => refresh(), 60_000);
    return () => clearInterval(id);
  }, [data.source, refresh]);

  // 浏览器直连模式：将本轮看板计算出的卖出信号交给邮件 Worker。
  // Worker 只负责发信与去重，不参与行情请求或策略计算。
  useEffect(() => {
    const endpoint = process.env.NEXT_PUBLIC_SELL_ALERT_URL;
    if (!endpoint || !directReady || process.env.NEXT_PUBLIC_DIRECT_BINANCE !== "1" || data.source !== "binance" || data.stale) return;

    const signals = data.coins
      .filter((coin) => coin.signal.action.side === "sell" && coin.signal.action.qty !== null && coin.signal.action.qty > 0)
      .map((coin) => ({
        symbol: coin.symbol,
        name: coin.name,
        kind: coin.signal.action.kind,
        label: coin.signal.action.label,
        price: coin.price,
        avgCost: coin.avgCost,
        returnPct: coin.returnPct,
        qty: coin.signal.action.qty,
        sellPct: coin.signal.action.sellPct,
        usdt: coin.signal.action.usdt,
        notes: coin.signal.action.notes,
      }));

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signals }),
      cache: "no-store",
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((result) => {
        if (result?.sent > 0) console.info("[sell-alert] 已发送卖出提醒", result.sent);
      })
      .catch((error) => console.warn("[sell-alert]", error));
  }, [data]);

  // 页面打开后每 60 秒调用一次 /api/notify；是否发信、冷却多久由服务端按 .env 决定
  useEffect(() => {
    if (typeof window === "undefined") return;
    const check = () => {
      fetch("/api/notify", { method: "POST", cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (j?.sent)
            console.info(
              "[mail-notify] 已发送",
              j.hits?.map((h: { symbol: string; score: number }) => `${h.symbol}=${h.score}`).join(", "),
            );
          else if (j?.reason) console.info("[mail-notify]", j.reason);
          else if (j?.error) console.warn("[mail-notify]", j.error);
        })
        .catch((e) => console.warn("[mail-notify]", e));
    };
    const first = window.setTimeout(check, 1500);
    const id = window.setInterval(check, 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);

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
                {tab === "queue" && <><BuyQueue data={data} refreshKey={queueVersion} /><SellQueue refreshKey={queueVersion} /></>}
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
      <BuyQueue data={data} refreshKey={queueVersion} />
      <SellQueue refreshKey={queueVersion} />
      <StrategyInfo />
      {notes}
      <div className="pt-6">{footer}</div>
    </main>
  );
}
