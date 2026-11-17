"use client";

import { useState } from "react";
import { useFlash, useSize } from "./hooks";
import type { CoinCard, Position } from "@/lib/types";
import { date, pct, price as fmtPrice, qty as fmtQty, tone, usd } from "@/lib/format";
import { strategyConfig as cfg } from "@/strategy.config";
import type { CoinSignal } from "@/strategy/types";
import { num } from "@/lib/format";
import { ScoreBar } from "./ScoreBar";

export const POS_COLOR: Record<Position, string> = { low: "var(--c-up)", mid: "var(--c-sub)", high: "var(--c-warn)" };
export const POS_LABEL: Record<Position, string> = { low: "低位买入", mid: "中位买入", high: "高位买入" };

const BUY_TAG = "border-up/40 bg-up/10 text-up";
const SELL_TAG = "border-down/40 bg-down/10 text-down";
export const TAG_STYLE: Record<string, string> = {
  头仓: BUY_TAG,
  补仓: BUY_TAG,
  备用金: "border-gold/50 bg-gold/10 text-gold",
  止盈: SELL_TAG,
  指标止盈: SELL_TAG,
  追踪止损: SELL_TAG,
  底仓减仓: SELL_TAG,
  暂缓: "border-warn/40 bg-warn/10 text-warn",
  观望: "border-line bg-soft text-mute",
};

/* ---------- 周线走势图：买入点 / 平均成本线 / 翻倍目标线 ---------- */
export function PriceChart({ coin, fill = false }: { coin: CoinCard; fill?: boolean }) {
  const [ref, w, mh] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const h = fill ? Math.max(56, mh) : 190;
  const pad = { l: 4, r: 4, t: 12, b: 4 };
  const s = coin.series;
  if (s.length < 2) return <div ref={ref} className={fill ? "h-full" : "h-[190px]"} />;

  const t0 = s[0].t;
  const t1 = s[s.length - 1].t;
  const target = coin.avgCost ? coin.avgCost * 2 : null;
  const vals = [...s.map((p) => p.c), ...(coin.avgCost ? [coin.avgCost] : [])];
  const dataMax = Math.max(...vals);
  const targetInRange = target !== null && target <= dataMax * 1.35;
  const max = (targetInRange ? Math.max(dataMax, target!) : dataMax) * 1.06;
  const min = Math.min(...vals) * 0.94;
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * Math.max(1, w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);
  const path = s.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.c).toFixed(1)}`).join("");
  const up = coin.returnPct === null ? s[s.length - 1].c >= s[0].c : coin.returnPct >= 0;
  const col = up ? "var(--c-up)" : "var(--c-down)";
  const gid = `g-${coin.symbol}`;
  const buys = coin.buys.filter((b) => b.t >= t0 - 7 * 864e5);
  const hb = buys.find((b) => b.id === hover);

  return (
    <div ref={ref} className={fill ? "relative h-full min-h-[56px]" : "relative"}>
      {w > 0 && (
        <svg className={fill ? "absolute inset-0" : undefined} width={w} height={h} role="img" aria-label={`${coin.symbol} 周线走势`} onPointerLeave={() => setHover(null)}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={col} stopOpacity="0.22" />
              <stop offset="100%" stopColor={col} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${path}L${x(t1)},${h}L${x(t0)},${h}Z`} fill={`url(#${gid})`} />
          <path d={path} fill="none" stroke={col} strokeWidth="1.8" strokeLinejoin="round" />

          {coin.avgCost && (
            <g>
              <line x1={pad.l} x2={w - pad.r} y1={y(coin.avgCost)} y2={y(coin.avgCost)} stroke="var(--c-fg)" strokeWidth="1.3" strokeDasharray="5 4" opacity="0.85" />
              <text x={pad.l + 2} y={y(coin.avgCost) - 4} fontSize="10" fill="var(--c-fg)" stroke="var(--c-halo)" strokeWidth="3" paintOrder="stroke">平均成本 {fmtPrice(coin.avgCost)}</text>
            </g>
          )}
          {target !== null && targetInRange && (
            <g>
              <line x1={pad.l} x2={w - pad.r} y1={y(target)} y2={y(target)} stroke="var(--c-gold)" strokeWidth="1.3" strokeDasharray="6 4" />
              <text x={w - pad.r - 2} y={y(target) + 12} fontSize="10" fill="var(--c-gold)" textAnchor="end" stroke="var(--c-halo)" strokeWidth="3" paintOrder="stroke">翻倍线 {fmtPrice(target)}</text>
            </g>
          )}
          {target !== null && !targetInRange && (
            <text x={w - pad.r - 2} y={11} fontSize="10" fill="var(--c-gold)" textAnchor="end">↑ 翻倍线 {fmtPrice(target)}</text>
          )}

          {buys.map((b) => {
            const active = hover === b.id;
            return (
              <g key={b.id}>
                <circle cx={x(b.t)} cy={y(b.price)} r={active ? 7 : 5} fill={POS_COLOR[b.position]} stroke="var(--c-bg)" strokeWidth="2" style={{ transition: "r .15s" }} />
                <circle cx={x(b.t)} cy={y(b.price)} r="14" fill="transparent" onPointerEnter={() => setHover(b.id)} onClick={() => setHover(b.id)} />
              </g>
            );
          })}
        </svg>
      )}
      {hb && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-line bg-pop px-3 py-2 text-xs shadow-xl"
          style={{ left: Math.min(Math.max(x(hb.t) - 70, 0), Math.max(0, w - 150)), top: Math.max(0, y(hb.price) - 78) }}
        >
          <div className="text-mute">{date(hb.t)} 买入</div>
          <div className="num text-fg">价格 {fmtPrice(hb.price)}</div>
          <div className="num text-fg">数量 {fmtQty(hb.qty)}</div>
          <div style={{ color: POS_COLOR[hb.position] }}>{POS_LABEL[hb.position]}</div>
        </div>
      )}
    </div>
  );
}

export default function CoinCardView({ coin }: { coin: CoinCard }) {
  const flash = useFlash(coin.price);
  const sig = coin.signal;
  const ret = coin.returnPct;
  const hasPos = coin.qty > 0 && coin.avgCost !== null;

  return (
    <article id={`coin-${coin.symbol}`} className="glass glass-hover fade-in scroll-mt-6 p-5 sm:p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold text-ink"
            style={{ background: `linear-gradient(135deg, ${coin.color}, ${coin.color}99)`, boxShadow: `0 0 20px -4px ${coin.color}88` }}
            aria-hidden
          >
            {coin.symbol.slice(0, 3)}
          </div>
          <div>
            <h3 className="text-lg font-semibold leading-tight">{coin.symbol}</h3>
            <p className="text-xs text-mute">{coin.name}</p>
          </div>
        </div>
        <div className="text-right">
          <p className={`num rounded px-1 text-xl font-semibold ${flash}`}>{fmtPrice(coin.price)}</p>
          <p className={`num text-xs ${tone(coin.change24h)}`}>24h {pct(coin.change24h, 2)}</p>
        </div>
      </header>

      <div className="mt-5 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] tracking-widest text-mute">相对平均成本</p>
          {hasPos && ret !== null ? (
            <p className={`num text-5xl font-extrabold leading-none ${tone(ret)}`}>{pct(ret, 1)}</p>
          ) : (
            <p className="text-2xl font-semibold text-mute">未持仓</p>
          )}
        </div>
        <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${TAG_STYLE[sig.tag]}`}>{sig.tag}</span>
      </div>

      <div className="mt-4">
        <PriceChart coin={coin} />
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-mute">
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full" style={{ background: POS_COLOR.low }} />低位买入</span>
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full" style={{ background: POS_COLOR.high }} />高位买入</span>
          <span className="flex items-center gap-1"><i className="inline-block w-4 border-t border-dashed border-fg" />平均成本</span>
          <span className="flex items-center gap-1"><i className="inline-block w-4 border-t border-dashed border-gold" />翻倍线</span>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-[11px] text-mute">持仓数量</dt>
          <dd className="num text-fg">{fmtQty(coin.qty)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-mute">持仓市值</dt>
          <dd className="num text-fg">{usd(coin.marketValue, 0)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-mute">平均成本</dt>
          <dd className="num text-fg">{coin.avgCost ? fmtPrice(coin.avgCost) : "—"}</dd>
        </div>
      </dl>

      {hasPos && (
        <div className="mt-5">
          <div className="mb-1.5 flex justify-between text-[11px] text-mute">
            <span>距翻倍</span>
            <span className={coin.toDoublePct === 0 ? "text-gold" : ""}>
              {coin.toDoublePct === 0 ? "已达翻倍线" : `还差 ${coin.toDoublePct!.toFixed(1)}%`}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-track">
            <div
              className="h-full rounded-full transition-all duration-1000"
              style={{ width: `${Math.max(2, coin.doubleProgress * 100)}%`, background: "linear-gradient(90deg,var(--c-up),var(--c-gold))" }}
            />
          </div>
        </div>
      )}

      <Indicators sig={sig} price={coin.price} />
    </article>
  );
}

/** 得分明细：价格位置（RSI 与 MA200 折减合并）、情绪、企稳；再加 BTC 状态和建议动作。 */
export function indicatorItems(sig: CoinSignal, price: number) {
  const m = sig.metrics;
  const b = sig.breakdown;
  const items: { label: string; value: string; hit: boolean; hint: string }[] = [];

  items.push({
    label: "周线 RSI",
    value: m.weeklyRsi !== null ? `${m.weeklyRsi.toFixed(0)} · ${b.rsi}分` : "—",
    hit: b.rsi > 0,
    hint: cfg.rsi.tiers.map((t) => `≤ ${t.max}: ${t.points}分`).join(" / "),
  });
  items.push({
    label: "对周线 MA200",
    value: m.ma200 !== null ? `${price / m.ma200 - 1 >= 0 ? "+" : ""}${((price / m.ma200 - 1) * 100).toFixed(0)}% · ${b.ma}分` : "—",
    hit: b.ma > 0,
    hint: cfg.ma.tiers.map((t) => `价格/MA200 ≤ ${t.max}: ${t.points}分`).join(" / "),
  });
  items.push({
    label: "恐惧贪婪",
    value: m.fearGreed !== null ? `${m.fearGreed} · ${b.sentiment}分` : "—",
    hit: b.sentiment > 0,
    hint: cfg.fearGreed.tiers.map((t) => `≤ ${t.max}: ${t.points}分`).join(" / "),
  });
  items.push({
    label: "企稳",
    value: m.stableCount === null ? "—" : `${m.stableCount}/3 · ${b.trend}分`,
    hit: m.stabilized === true,
    hint: "收盘>上周最高；RSI<45 且回升；近 4 周未创 8 周新低",
  });

  return items;
}

/** 建议动作：买入给金额和被哪些上限压低；卖出给数量；被挡住的列出原因。 */
export function ActionBox({ sig, compact = false }: { sig: CoinSignal; compact?: boolean }) {
  const a = sig.action;
  const lines: { text: string; tone: string }[] = [];
  if (a.side === "buy") {
    const planned = a.plannedUsdt !== null && a.usdt !== null && a.usdt < a.plannedUsdt ? `（计划 $${num(a.plannedUsdt)}）` : "";
    lines.push({
      text: a.usdt !== null ? `${a.label}：建议买入 $${num(a.usdt)}${planned}` : `${a.label}：满足条件，仅给方向`,
      tone: "text-up",
    });
    a.limits.forEach((t) => lines.push({ text: t, tone: "text-mute" }));
  } else if (a.side === "sell") {
    const sellPct = a.sellPct !== null ? Math.round(a.sellPct * 100) : "?";
    const approx = a.usdt !== null ? `（约 $${num(a.usdt)}）` : "";
    lines.push({ text: `${a.label}：建议卖出 ${sellPct}%${approx}`, tone: "text-down" });
  } else if (a.blocked.length) {
    lines.push({ text: `${a.label || "买入"}：暂缓`, tone: "text-warn" });
    a.blocked.forEach((t) => lines.push({ text: t, tone: "text-mute" }));
  }
  a.notes.forEach((t) => lines.push({ text: t, tone: "text-mute" }));
  if (!lines.length) return null;
  const shown = compact ? lines.slice(0, 2) : lines;
  const cls = compact
    ? "mt-1 space-y-0.5 text-[10px] leading-snug"
    : "mt-3 space-y-1 rounded-lg border border-line bg-soft px-3 py-2 text-xs";
  return (
    <ul className={cls}>
      {shown.map((l, i) => (
        <li key={i} className={i === 0 ? `font-medium ${l.tone}` : l.tone}>{l.text}</li>
      ))}
    </ul>
  );
}

function Indicators({ sig, price }: { sig: CoinSignal; price: number }) {
  const items = indicatorItems(sig, price);
  return (
    <div className="mt-4 border-t border-line pt-3">
      <ActionBox sig={sig} />
      <div className="mb-1 flex items-center justify-between text-[11px] text-mute">
        <span>
          机会指数 <b className="num text-sm text-fg">{sig.score}</b> / {cfg.scoreMax}
        </span>
        <span>{sig.group === "core" ? "积极型" : "保守型"}</span>
      </div>
      <ScoreBar score={sig.score} group={sig.group} max={cfg.scoreMax} />
      <ul className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
        {items.map((it) => (
          <li key={it.label} className="flex items-center justify-between gap-2" title={it.hint}>
            <span className="text-mute">{it.label}</span>
            <span className={`num ${it.hit ? "font-semibold text-up" : "text-sub"}`}>
              {it.value}
              {it.hit && <i className="ml-1 not-italic">✓</i>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
