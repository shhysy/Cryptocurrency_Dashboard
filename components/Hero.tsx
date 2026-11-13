"use client";

import type { CoinSignal, VerdictKind } from "@/strategy/types";
import type { DashboardData } from "@/lib/types";
import { num, pct } from "@/lib/format";
import { watchlist } from "@/watchlist.config";


const META: Record<VerdictKind, { icon: string; title: string; sub: string }> = {
  none: { icon: "😴", title: "今日不宜操作", sub: "市场无明显机会，耐心持有" },
  accumulate: { icon: "🟢", title: "适合买入", sub: "出现温和的低位信号" },
  strong: { icon: "🔥", title: "强烈买入区间", sub: "多项长期指标同时处于低位" },
  sell: { icon: "🔴", title: "建议卖出", sub: "触发止盈 / 止损条件" },
};

const chipTone: Record<VerdictKind, string> = {
  none: "border-line text-mute",
  accumulate: "border-up/40 text-up",
  strong: "border-gold/50 text-gold",
  sell: "border-down/40 text-down",
};

const chipText = (s: CoinSignal) => (s.tag === "观望" ? "观望" : s.tag);

const DETAIL = "mt-3 text-base text-sub sm:text-lg fit:mt-1! fit:text-sm!";

function Detail({ sig, kind }: { sig: CoinSignal | null; kind: VerdictKind }) {
  if (!sig) return <p className={DETAIL}>长期投资，大多数日子都不需要动作</p>;
  const a = sig.action;
  if (a.side === "buy") {
    return (
      <p className={DETAIL}>
        <b className="text-fg">{sig.symbol}</b> · {a.label}
        {a.usdt !== null ? (
          <>
            {" "}· 建议买入 <b className="text-fg">${num(a.usdt)}</b>
            {a.plannedUsdt !== null && a.usdt < a.plannedUsdt ? (
              <span className="text-mute">（计划 ${num(a.plannedUsdt)}）</span>
            ) : null}
          </>
        ) : (
          <span className="text-mute">（仅给方向，不给金额）</span>
        )}
        <span className="text-mute"> · 机会 {sig.score}/90</span>
      </p>
    );
  }
  if (a.side === "sell" && a.qty !== null) {
    return (
      <p className={DETAIL}>
        <b className="text-fg">{sig.symbol}</b> · {a.label} · 建议卖出{" "}
        <b className="text-fg">{a.sellPct !== null ? `${Math.round(a.sellPct * 100)}%` : ""}</b>
        {a.usdt !== null ? <span className="text-mute">（约 ${num(a.usdt)}）</span> : null}
        {sig.metrics.returnPct !== null ? <span className="text-mute"> · 当前收益 {pct(sig.metrics.returnPct, 0)}</span> : null}
      </p>
    );
  }
  return <p className={DETAIL}>长期投资，大多数日子都不需要动作</p>;
}

/** 恐惧贪婪指数等级和色调。越恐惧越接近买点（绿），越贪婪越接近卖点（红），分档同 alternative.me。 */
function fearGreedLevel(v: number): { label: string; tone: string } {
  if (v <= 24) return { label: "极度恐惧", tone: "border-up/50 bg-up/10 text-up" };
  if (v <= 49) return { label: "恐惧", tone: "border-up/30 text-up" };
  if (v === 50) return { label: "中性", tone: "border-line text-sub" };
  if (v <= 74) return { label: "贪婪", tone: "border-warn/40 text-warn" };
  return { label: "极度贪婪", tone: "border-down/50 bg-down/10 text-down" };
}

function FearGreedBadge({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <div className="shrink-0 rounded-xl border border-line bg-soft px-3 py-2 text-center text-mute fit:px-2 fit:py-1.5">
        <p className="text-[10px] tracking-widest">恐慌指数</p>
        <p className="text-sm">暂无</p>
      </div>
    );
  }
  const lvl = fearGreedLevel(value);
  return (
    <div
      className={`shrink-0 rounded-xl border px-5 py-3 text-center ${lvl.tone} fit:px-3 fit:py-2`}
      title="恐惧贪婪指数（alternative.me）：≤25 极度恐惧，≥80 过热"
    >
      <p className="text-xs tracking-widest opacity-80 fit:text-[10px]">今日恐慌指数</p>
      <p className="num my-1 text-5xl font-extrabold leading-none sm:text-7xl fit:my-0.5 fit:text-4xl!">{value}</p>
      <p className="text-sm font-medium fit:text-xs">{lvl.label}</p>
    </div>
  );
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
        <FearGreedBadge value={data.market.fearGreed} />
        <div className="hero-icon select-none text-[72px] leading-none sm:text-[112px] fit:text-[56px]!" aria-hidden>
   {m.icon}
        </div>
 <div className="min-w-0 flex-1">
          <p className="text-xs tracking-[0.3em] text-mute fit:text-[10px]">今日结论 · 周线</p>
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
   <p className="text-sm text-mute fit:text-[13px]">依据：所有币种的周线 RSI、周线 MA200、恐惧贪婪指数，得分均未达到 30 分。</p>
        )}

        <div className="mt-5 flex flex-wrap gap-2 fit:mt-2.5 fit:gap-1.5">
   {[...(sig ? [sig] : []), ...verdict.others].map((s) => (
     <a
       key={s.symbol}
       href={`#coin-${s.symbol}`}
       title={`${names[s.symbol] ?? s.symbol} · 机会指数 ${s.score} / 90`}
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
