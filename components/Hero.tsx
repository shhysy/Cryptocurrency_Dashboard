"use client";

import type { CoinSignal, MarketState, VerdictKind } from "@/strategy/types";
import type { DashboardData } from "@/lib/types";
import { num, pct } from "@/lib/format";
import { watchlist } from "@/watchlist.config";

const META: Record<VerdictKind, { icon: string; title: string; sub: string }> = {
  none: { icon: "😴", title: "今日不宜操作", sub: "市场无明显机会，耐心持有" },
  accumulate: { icon: "🟢", title: "适合买入", sub: "出现温和的低位信号" },
  strong: { icon: "🔥", title: "强烈买入区间", sub: "多项长期指标同时处于低位" },
  sell: { icon: "🔴", title: "建议卖出", sub: "触发止盈 / 止损条件" },
};

/** BTC 市场状态：直接影响买入金额与是否允许新增山寨。 */
const BTC_STATE: Record<MarketState, { label: string; tone: string; hint: string }> = {
  bear: {
    label: "熊市",
    tone: "border-down/50 bg-down/10 text-down",
    hint: "收盘 < MA200 且 MA200 下行 · 山寨禁止新增，核心金额 ×0.7",
  },
  transition: {
    label: "过渡",
    tone: "border-warn/40 bg-warn/10 text-warn",
    hint: "MA200 方向与价格位置不一致 · 核心 ×0.85，山寨 ×0.5",
  },
  bull: {
    label: "牛市",
    tone: "border-up/40 bg-up/10 text-up",
    hint: "收盘 ≥ MA200 且 MA200 不下行 · 正常参数",
  },
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
        {sig.metrics.returnPct !== null ? (
          <span className="text-mute"> · 浮盈 {pct(sig.metrics.returnPct, 1)}</span>
        ) : null}
      </p>
    );
  }
  if (a.blocked.length) {
    return (
      <p className={DETAIL}>
        <b className="text-fg">{sig.symbol}</b> · {a.label || "买入"}暂缓
        <span className="text-mute"> · {a.blocked[0]}</span>
        <span className="text-mute"> · 机会 {sig.score}/90</span>
      </p>
    );
  }
  return (
    <p className={DETAIL}>
      <b className="text-fg">{sig.symbol}</b> · {sig.tag}
      <span className="text-mute"> · 机会 {sig.score}/90</span>
      {kind === "none" ? <span className="text-mute"> · 未达行动条件</span> : null}
    </p>
  );
}

function FearGreedBadge({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <div className="shrink-0 rounded-xl border border-line bg-soft px-5 py-3 text-center text-mute fit:px-3 fit:py-2">
        <p className="text-xs tracking-widest fit:text-[10px]">今日恐慌指数</p>
        <p className="num my-1 text-3xl font-semibold fit:text-2xl">—</p>
        <p className="text-sm fit:text-xs">暂无数据</p>
      </div>
    );
  }
  const lvl =
    value <= 25
      ? { label: "极度恐惧", tone: "border-up/50 bg-up/10 text-up" }
      : value <= 45
        ? { label: "恐惧", tone: "border-calm/40 bg-calm/10 text-calm" }
        : value <= 55
          ? { label: "中性", tone: "border-line bg-soft text-sub" }
          : value <= 75
            ? { label: "贪婪", tone: "border-warn/40 bg-warn/10 text-warn" }
            : { label: "极度贪婪", tone: "border-down/40 bg-down/10 text-down" };
  return (
    <div
      className={`shrink-0 rounded-xl border px-5 py-3 text-center ${lvl.tone} fit:px-3 fit:py-2`}
      title="恐惧贪婪指数（alternative.me）：≤25 极度恐惧，≥80 过热"
    >
      <p className="text-xs tracking-widest opacity-80 fit:text-[10px]">今日恐慌指数</p>
      <p className={`num my-1 text-5xl font-extrabold leading-none sm:text-7xl fit:my-0.5 fit:text-4xl!`}>{value}</p>
      <p className="text-sm font-medium fit:text-xs">{lvl.label}</p>
    </div>
  );
}

function BtcStateBadge({ state }: { state: MarketState | null }) {
  if (!state) {
    return (
      <div className="shrink-0 rounded-xl border border-line bg-soft px-3 py-2 text-center text-mute fit:px-2 fit:py-1.5">
        <p className="text-[10px] tracking-widest">BTC 状态</p>
        <p className="text-sm">暂无</p>
      </div>
    );
  }
  const s = BTC_STATE[state];
  return (
    <div
      className={`shrink-0 rounded-xl border px-4 py-3 text-center ${s.tone} fit:px-2.5 fit:py-2`}
      title={s.hint}
    >
      <p className="text-[10px] tracking-widest opacity-80 fit:text-[9px]">BTC 市场</p>
      <p className="mt-1 text-xl font-extrabold leading-none sm:text-2xl fit:text-lg">{s.label}</p>
      <p className="mt-1 text-[10px] opacity-70 fit:text-[9px]">周线 · MA200</p>
    </div>
  );
}

/** 右侧机会一览：按得分排序，显示距观察线(30) / 门槛的距离与迷你条。 */
function OpportunityBoard({
  signals,
  names,
}: {
  signals: CoinSignal[];
  names: Record<string, string>;
}) {
  const WATCH_LINE = 30; // 与 engine 里「低分汇总」观察线一致
  const sorted = [...signals].sort((a, b) => b.score - a.score);
  if (!sorted.length) return null;

  return (
    <div className="mt-4 fit:mt-2.5">
      <div className="mb-2 flex items-center justify-between text-[11px] text-mute fit:mb-1.5 fit:text-[10px]">
        <span>机会一览</span>
        <span>观察线 {WATCH_LINE} · 满分 90</span>
      </div>
      <ul className="space-y-2 fit:space-y-1.5">
        {sorted.map((s) => {
          const pctVal = Math.min(100, (s.score / 90) * 100);
          const gap = Math.max(0, WATCH_LINE - s.score);
          const near = s.score >= WATCH_LINE;
          return (
            <li key={s.symbol}>
              <a
                href={`#coin-${s.symbol}`}
                className="group block rounded-lg border border-line bg-soft/60 px-2.5 py-1.5 transition hover:border-gold/40 hover:bg-soft fit:px-2 fit:py-1"
                title={`${names[s.symbol] ?? s.symbol} · ${s.tag} · ${s.score}/90`}
              >
                <div className="flex items-center justify-between gap-2 text-xs fit:text-[11px]">
                  <span className="font-medium text-fg">
                    {s.symbol}
                    <span className="ml-1.5 font-normal text-mute">{chipText(s)}</span>
                  </span>
                  <span className={`num tabular-nums ${near ? "text-up" : "text-sub"}`}>
                    {s.score}
                    <span className="text-mute">/90</span>
                    {!near && gap > 0 ? (
                      <span className="ml-1.5 text-[10px] text-mute">差 {gap}</span>
                    ) : null}
                  </span>
                </div>
                <div className="relative mt-1 h-1 overflow-hidden rounded-full bg-track fit:mt-0.5 fit:h-0.5">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${pctVal}%`,
                      background: near
                        ? "linear-gradient(90deg, var(--c-up), var(--c-gold))"
                        : "linear-gradient(90deg, var(--c-calm), var(--c-sub))",
                    }}
                  />
                  <i
                    className="absolute top-0 h-full w-px bg-gold/70"
                    style={{ left: `${(WATCH_LINE / 90) * 100}%` }}
                    aria-hidden
                  />
                </div>
              </a>
            </li>
          );
        })}
      </ul>
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
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-stretch fit:flex-col fit:gap-1.5">
          <FearGreedBadge value={data.market.fearGreed} />
          <BtcStateBadge state={data.market.btcState} />
        </div>
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
          <p className="text-sm text-mute fit:text-[13px]">
            依据：各币机会指数均未达到观察线（30 分）。下方按得分从高到低排列，方便盯最接近机会的品种。
          </p>
        )}

        {/* 机会一览：比「一排观望标签」更有信息量，填满右侧留白 */}
        <OpportunityBoard signals={[...(sig ? [sig] : []), ...verdict.others]} names={names} />
      </div>
    </section>
  );
}
