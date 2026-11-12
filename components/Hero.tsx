"use client";

import type { CoinSignal, VerdictKind } from "@/strategy/types";
import type { DashboardData } from "@/lib/types";
import { num, pct } from "@/lib/format";
import { watchlist } from "@/watchlist.config";

const META: Record<VerdictKind, { icon: string; title: string; sub: string }> = {
  none: { icon: "😴", title: "今日不宜操作", sub: "市场无明显机会，耐心持有" },
  accumulate: { icon: "🟢", title: "适合加仓", sub: "出现温和的低位信号" },
  strong: { icon: "🔥", title: "强烈买入区间", sub: "多项长期指标同时处于低位" },
  risk: { icon: "🟡", title: "注意风险，暂停加仓", sub: "先不动，等指标回落" },
  sell: { icon: "🔴", title: "达到卖出条件", sub: "可分批止盈，先收回本金" },
};

const chipTone: Record<VerdictKind, string> = {
  none: "border-line text-mute",
  accumulate: "border-up/40 text-up",
  strong: "border-gold/50 text-gold",
  risk: "border-warn/40 text-warn",
  sell: "border-down/40 text-down",
};

const chipText = (s: CoinSignal) =>
  s.kind === "sell" ? "可卖出" : s.kind === "risk" ? s.tag : s.kind === "strong" ? "强烈买入" : s.kind === "accumulate" ? "加仓区" : "观望";

const DETAIL = "mt-3 text-base text-sub sm:text-lg fit:mt-1! fit:text-sm!";

function Detail({ sig, kind }: { sig: CoinSignal | null; kind: VerdictKind }) {
  if (sig && (kind === "accumulate" || kind === "strong")) {
    return (
      <p className={DETAIL}>
        <b className="text-fg">{sig.symbol}</b> · 建议动用剩余额度的 <b className="text-fg">{sig.addPct}%</b>
        {sig.addAmountCny ? <>（约 ¥{num(sig.addAmountCny)}）</> : null}
        <span className="text-mute"> · 机会指数 {sig.score}</span>
      </p>
    );
  }
  if (sig && kind === "sell" && sig.sellMin !== null && sig.sellMax !== null) {
    return (
      <p className={DETAIL}>
 <b className="text-fg">{sig.symbol}</b> · 建议卖出持仓的{" "}
        <b className="text-fg">
   {Math.round(sig.sellMin * 100)}% ~ {Math.round(sig.sellMax * 100)}%
 </b>
 {sig.metrics.returnPct !== null && <span className="text-mute"> · 当前收益 {pct(sig.metrics.returnPct, 0)}</span>}
      </p>
    );
  }
  if (sig && kind === "risk") {
    return (
      <p className={DETAIL}>
        涉及 <b className="text-fg">{sig.symbol}</b> · 暂不加仓，不需要恐慌卖出
      </p>
    );
  }
  return <p className={DETAIL}>长期投资，大多数日子都不需要动作</p>;
}

export default function Hero({ data }: { data: DashboardData }) {
  const { verdict } = data;
  const m = META[verdict.kind];
  const sig = verdict.primary;
  const names = Object.fromEntries(watchlist.map((w) => [w.symbol, w.name]));

  return (
    <section
      className={`hero hero-${verdict.kind} fade-in px-6 py-10 sm:px-12 sm:py-16 fit:grid fit:shrink-0 fit:grid-cols-[1.15fr_1fr] fit:items-center fit:gap-6 fit:px-7! fit:py-4!`}
      aria-live="polite"
    >
      <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:gap-10 fit:gap-5!">
        <div className="hero-icon select-none text-[72px] leading-none sm:text-[112px] fit:text-[56px]!" aria-hidden>
   {m.icon}
        </div>
 <div className="min-w-0 flex-1">
          <p className="text-xs tracking-[0.3em] text-mute fit:text-[10px]">今日结论 · 周线 / 月线</p>
          <h1
     className={`hero-title-${verdict.kind} mt-2 text-[44px] font-extrabold leading-[1.08] sm:text-7xl lg:text-[84px] fit:mt-0.5! fit:text-[clamp(32px,3.3vw,60px)]!`}
          >
     {m.title}
   </h1>
   <Detail sig={sig} kind={verdict.kind} />
          {!sig && <p className="mt-1 text-sm text-mute fit:text-xs">{m.sub}</p>}
        </div>
      </div>

      <div className="mt-8 border-t border-line pt-5 fit:mt-0 fit:border-l fit:border-t-0 fit:pl-6 fit:pt-0">
        {verdict.reasons.length > 0 ? (
          <ul className="space-y-1.5 text-sm text-sub fit:space-y-0.5 fit:text-[13px]">
            {verdict.reasons.map((r) => (
       <li key={r.key} className="flex gap-2">
         <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
         <span>{r.text}</span>
</li>
     ))}
          </ul>
 ) : (
   <p className="text-sm text-mute fit:text-[13px]">依据：所有币种的周线 RSI、52 周回撤、均线位置，均未触发任何阈值。</p>
        )}

        <div className="mt-5 flex flex-wrap gap-2 fit:mt-2.5 fit:gap-1.5">
   {[...(sig ? [sig] : []), ...verdict.others].map((s) => (
     <a
       key={s.symbol}
       href={`#coin-${s.symbol}`}
       title={`${names[s.symbol] ?? s.symbol} · 机会指数 ${s.score}`}
       className={`rounded-full border bg-soft px-3 py-1 text-xs transition hover:bg-soft-2 fit:px-2 fit:py-0.5 fit:text-[11px] ${chipTone[s.kind]}`}
     >
       {s.symbol} · {chipText(s)}
     </a>
   ))}
        </div>
      </div>
    </section>
  );
}
