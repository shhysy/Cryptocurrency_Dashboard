"use client";

import { useState } from "react";
import { CountUp, useWidth } from "./hooks";
import type { DashboardData } from "@/lib/types";
import { date, num, pct, tone, usd } from "@/lib/format";

/* ---------- 资产增长曲线 ---------- */
export function EquityChart({ data, height = 220 }: { data: DashboardData["equityCurve"]; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const h = height;
  const pad = { l: 8, r: 8, t: 14, b: 22 };
  if (data.length < 2) return <div ref={ref} style={{ height }} />;

  const max = Math.max(...data.map((d) => Math.max(d.value, d.invested))) * 1.08;
  const x = (i: number) => pad.l + (i / (data.length - 1)) * Math.max(1, w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (h - pad.t - pad.b);
  const line = (k: "value" | "invested") => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join("");
  const area = `${line("value")}L${x(data.length - 1)},${h - pad.b}L${x(0)},${h - pad.b}Z`;
  const last = data[data.length - 1];
  const up = last.value >= last.invested;
  const col = up ? "var(--c-up)" : "var(--c-down)";
  const hd = hover !== null ? data[hover] : null;

  return (
    <div ref={ref} className="relative">
      {w > 0 && (
        <svg
          width={w}
          height={h}
          role="img"
   aria-label="资产增长曲线"
          onPointerMove={(e) => {
     const r = e.currentTarget.getBoundingClientRect();
     const i = Math.round(((e.clientX - r.left - pad.l) / Math.max(1, w - pad.l - pad.r)) * (data.length - 1));
     setHover(Math.max(0, Math.min(data.length - 1, i)));
          }}
          onPointerLeave={() => setHover(null)}
        >
   <defs>
     <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
       <stop offset="0%" stopColor={col} stopOpacity="0.35" />
       <stop offset="100%" stopColor={col} stopOpacity="0" />
            </linearGradient>
   </defs>
          {[0.25, 0.5, 0.75].map((f) => (
     <line key={f} x1={pad.l} x2={w - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--c-grid)" />
   ))}
   <path d={area} fill="url(#eq-fill)" />
          <path d={line("invested")} fill="none" stroke="var(--c-gold)" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.8" />
   <path d={line("value")} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" />
   <circle cx={x(data.length - 1)} cy={y(last.value)} r="4" fill={col} stroke="var(--c-bg)" strokeWidth="2" />
   <text x={pad.l} y={h - 4} fontSize="10" fill="var(--c-mute)">{date(data[0].t)}</text>
          <text x={w - pad.r} y={h - 4} fontSize="10" fill="var(--c-mute)" textAnchor="end">{date(last.t)}</text>
   {hover !== null && hd && (
     <g>
       <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={h - pad.b} stroke="var(--c-tick)" />
       <circle cx={x(hover)} cy={y(hd.value)} r="4" fill={col} stroke="var(--c-bg)" strokeWidth="2" />
     </g>
          )}
        </svg>
      )}
      {hd && hover !== null && (
 <div
   className="pointer-events-none absolute top-1 rounded-lg border border-line bg-pop px-3 py-2 text-xs shadow-xl"
   style={{ left: Math.min(Math.max(x(hover) - 70, 0), Math.max(0, w - 150)) }}
        >
   <div className="text-mute">{date(hd.t)}</div>
          <div className="num text-fg">市值 {usd(hd.value, 0)}</div>
          <div className="num text-gold">本金 {usd(hd.invested, 0)}</div>
 </div>
      )}
      <div className="mt-2 flex gap-4 text-xs text-mute">
        <span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-4" style={{ background: col }} />资产市值</span>
 <span className="flex items-center gap-1.5"><i className="inline-block h-0 w-4 border-t border-dashed border-gold" />累计投入</span>
      </div>
    </div>
  );
}

/* ---------- 持仓占比环形图 ---------- */
export function Donut({ items, compact = false }: { items: DashboardData["allocation"]; compact?: boolean }) {
  const [active, setActive] = useState<string | null>(null);
  const size = 168;
  const r = 62;
  const sw = 18;
  const C = 2 * Math.PI * r;
  const gap = items.length > 1 ? 3 : 0;
  let acc = 0;
  const cur = items.find((i) => i.symbol === active);

  return (
    <div className={compact ? "flex items-center gap-3" : "flex flex-col items-center gap-4 sm:flex-row lg:flex-col xl:flex-row"}>
      <svg width={compact ? 96 : size} height={compact ? 96 : size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="持仓占比">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--c-grid)" strokeWidth={sw} />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
   {items.map((it) => {
            const len = it.weight * C;
     const seg = (
       <circle
  key={it.symbol}
  cx={size / 2}
         cy={size / 2}
         r={r}
  fill="none"
         stroke={it.color}
         strokeWidth={active === it.symbol ? sw + 4 : sw}
  strokeDasharray={`${Math.max(0, len - gap)} ${C}`}
         strokeDashoffset={-acc * C}
  opacity={active && active !== it.symbol ? 0.35 : 1}
  style={{ transition: "all .2s" }}
         onPointerEnter={() => setActive(it.symbol)}
  onPointerLeave={() => setActive(null)}
/>
     );
     acc += it.weight;
     return seg;
   })}
 </g>
 <text x="50%" y="47%" textAnchor="middle" fontSize="11" fill="var(--c-mute)">{cur ? cur.symbol : "持仓占比"}</text>
        <text x="50%" y="60%" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--c-fg)" className="num">
          {cur ? `${(cur.weight * 100).toFixed(1)}%` : `${items.length} 币`}
        </text>
      </svg>
      <ul className={compact ? "grid w-full grid-cols-2 gap-x-4 gap-y-1 text-xs" : "w-full space-y-2 text-sm"}>
        {items.map((it) => (
          <li
     key={it.symbol}
     className="flex items-center justify-between gap-3"
     onPointerEnter={() => setActive(it.symbol)}
     onPointerLeave={() => setActive(null)}
   >
     <span className="flex items-center gap-2 text-sub">
       <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: it.color }} />
       {it.symbol}
     </span>
     <span className="num text-fg">{(it.weight * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- 整体收益率进度条（0% / +50% / +100%） ---------- */
function ReturnBar({ ret }: { ret: number }) {
  const MAX = 1.2; // 轨道显示到 +120%，翻倍线落在 83%
  const pos = (v: number) => `${(Math.max(-0.1, Math.min(MAX, v)) + 0.1) / (MAX + 0.1) * 100}%`;
  const marks = [
    { v: 0, label: "0%" },
    { v: 0.5, label: "+50%" },
    { v: 1, label: "+100% 翻倍" },
  ];
  const fill = ret >= 0 ? "linear-gradient(90deg,var(--c-up),var(--c-gold))" : "linear-gradient(90deg,var(--c-down),var(--c-warn))";
  const from = pos(0);
  const to = pos(ret);
  const left = ret >= 0 ? from : to;
  const width = `${Math.abs(parseFloat(to) - parseFloat(from))}%`;
  return (
    <div>
      <div className="relative h-3 rounded-full bg-track">
        <div className="absolute inset-y-0 rounded-full transition-all duration-1000" style={{ left, width, background: fill, boxShadow: "0 0 18px var(--c-glow)" }} />
        {marks.map((m) => (
   <i key={m.v} className="absolute top-[-4px] h-5 w-px bg-tick" style={{ left: pos(m.v) }} />
        ))}
        <i
   className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-fg shadow-[0_0_14px_var(--c-glow)] transition-all duration-1000"
          style={{ left: pos(ret) }}
        />
      </div>
      <div className="relative mt-3 h-5 text-[11px] text-mute">
 {marks.map((m, i) => (
   <span
     key={m.v}
     className={`absolute whitespace-nowrap ${m.v === 1 ? "text-gold" : ""}`}
            style={{ left: pos(m.v), transform: i === 0 ? "translateX(-20%)" : i === marks.length - 1 ? "translateX(-80%)" : "translateX(-50%)" }}
          >
     {m.label}
          </span>
 ))}
      </div>
    </div>
  );
}

export default function Overview({ data }: { data: DashboardData }) {
  const s = data.summary;
  return (
    <section className="grid gap-4 lg:grid-cols-3" aria-label="资产总览">
      <div className="glass fade-in p-6 sm:p-8 lg:col-span-3">
        <div className="grid gap-8 sm:grid-cols-3">
          <div>
     <p className="text-xs tracking-widest text-mute">总资产 · USDT 折合</p>
     <p className="mt-2 text-4xl font-bold text-fg sm:text-5xl">
       <CountUp value={s.totalAssets} format={(n) => usd(n, 0)} />
     </p>
     <p className="num mt-1 text-xs text-mute">≈ ¥{num(s.totalAssets * s.usdtCny)} · 持仓 {usd(s.totalValue, 0)}</p>
   </div>
   <div>
     <p className="text-xs tracking-widest text-mute">总投入本金</p>
     <p className="mt-2 text-4xl font-bold text-sub sm:text-5xl">
       <CountUp value={s.totalInvested} format={(n) => usd(n, 0)} />
     </p>
     <p className="num mt-1 text-xs text-mute">
       ≈ ¥{num(s.investedCny)}
     </p>
   </div>
          <div>
     <p className="text-xs tracking-widest text-mute">总浮盈亏</p>
     <p className={`mt-2 text-4xl font-bold sm:text-5xl ${tone(s.pnl)}`}>
<CountUp value={s.pnl} format={(n) => `${n >= 0 ? "+" : "-"}${usd(Math.abs(n), 0)}`} />
     </p>
     <p className={`num mt-1 text-lg font-semibold ${tone(s.pnlPct)}`}>
       <CountUp value={s.pnlPct * 100} format={(n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`} />
     </p>
          </div>
 </div>

        <div className="mt-8">
          <div className="mb-3 flex items-baseline justify-between text-xs text-mute">
     <span>整体收益进度</span>
     <span>
       {s.pnlPct >= 1 ? "已达翻倍" : `距翻倍还差 ${(Math.max(0, 1 - s.pnlPct) * 100).toFixed(1)} 个百分点`}
     </span>
   </div>
          <ReturnBar ret={s.pnlPct} />
        </div>
      </div>

      <div className="glass fade-in p-6 lg:col-span-2">
        <h2 className="mb-3 text-sm font-medium text-sub">资产增长曲线 · 按周</h2>
        <EquityChart data={data.equityCurve} />
      </div>
      <div className="glass fade-in p-6">
        <h2 className="mb-4 text-sm font-medium text-sub">持仓占比</h2>
 <Donut items={data.allocation} />
      </div>
    </section>
  );
}

/** 一屏模式用的紧凑汇总条：三个核心数字 + 收益进度条，一行放下。 */
export function SummaryStrip({ data }: { data: DashboardData }) {
  const s = data.summary;
  return (
    <section className="glass fade-in shrink-0 px-5 py-3" aria-label="资产总览">
      <div className="grid grid-cols-[1fr_1fr_1fr_1.5fr] items-center gap-5">
        <div>
   <p className="text-[10px] tracking-widest text-mute">总资产 · USDT 折合</p>
   <p className="text-2xl font-bold text-fg xl:text-3xl"><CountUp value={s.totalAssets} format={(n) => usd(n, 0)} /></p>
   <p className="num text-[10px] text-mute">≈ ¥{num(s.totalAssets * s.usdtCny)} · 持仓 {usd(s.totalValue, 0)}</p>
 </div>
        <div>
          <p className="text-[10px] tracking-widest text-mute">总投入本金</p>
          <p className="text-2xl font-bold text-sub xl:text-3xl"><CountUp value={s.totalInvested} format={(n) => usd(n, 0)} /></p>
          <p className="num text-[10px] text-mute">≈ ¥{num(s.investedCny)}</p>
        </div>
 <div>
   <p className="text-[10px] tracking-widest text-mute">总浮盈亏</p>
   <p className={`text-2xl font-bold xl:text-3xl ${tone(s.pnl)}`}>
     <CountUp value={s.pnl} format={(n) => `${n >= 0 ? "+" : "-"}${usd(Math.abs(n), 0)}`} />
          </p>
   <p className={`num text-xs font-semibold ${tone(s.pnlPct)}`}>
     <CountUp value={s.pnlPct * 100} format={(n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`} />
          </p>
        </div>
 <div>
          <div className="mb-1.5 flex items-baseline justify-between text-[10px] text-mute">
     <span>整体收益进度</span>
     <span>{s.pnlPct >= 1 ? "已达翻倍" : `距翻倍还差 ${(Math.max(0, 1 - s.pnlPct) * 100).toFixed(1)} 个百分点`}</span>
   </div>
   <ReturnBar ret={s.pnlPct} />
        </div>
      </div>
    </section>
  );
}
