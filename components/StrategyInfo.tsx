import { strategyConfig as c } from "@/strategy.config";

const p = (x: number) => `${Math.round(x * 100)}%`;

export default function StrategyInfo({ bare = false }: { bare?: boolean }) {
  const rows: { title: string; items: string[]; tone: string }[] = [
    {
      title: "买入 / 加仓",
      tone: "text-up",
      items: [
        `周线 RSI(${c.rsi.period}) < ${c.rsi.weeklyBuy}：偏低，提示加仓；< ${c.rsi.weeklyStrongBuy}：强烈买入`,
        `较近 ${c.drawdown.lookbackWeeks} 周高点回撤 ${c.drawdown.tiers.map((t) => `≥${p(t.dd)}（${t.label}）`).join(" / ")}`,
        `价格接近或跌破周线 MA${c.ma.weeklyPeriod}（数据不足时用月线 MA${c.ma.monthlyFallbackPeriod}），接近线 +${p(c.ma.nearPct)} 以内`,
 `月线 RSI ≤ ${c.rsi.monthlyLow}：历史低位区`,
        ...(c.useCostSignals ? [`当前价低于平均成本 ${p(-c.cost.belowCostPct)}：可摊低成本（受仓位上限约束）`] : []),
      ],
    },
    {
      title: "暂停 / 风险",
      tone: "text-warn",
      items: [
        `周线 RSI > ${c.rsi.weeklyOverheated}：过热，暂停加仓`,
        `价格高于周线 MA${c.ma.deviationPeriod} ${p(c.ma.overheatDeviation)} 以上：过热`,
        `单币仓位占比 > ${p(c.risk.maxCoinWeight)}：暂停加仓，提示再平衡`,
        `持仓市值 ≥ ¥${c.risk.maxTotalCapitalCny.toLocaleString("en-US")}（1 USDT ≈ ¥${c.risk.usdtCny}）：暂停加仓`,
      ],
    },
    {
      title: "卖出 / 减仓",
      tone: "text-down",
      items: [
        ...(c.useCostSignals
   ? c.sell.levels.map((l) => `收益率 ≥ +${p(l.ret)}：建议卖出 ${p(l.min)} ~ ${p(l.max)}${l.ret === 1 ? "（先收回本金）" : ""}`)
   : []),
        `周线 RSI > ${c.rsi.weeklySell}${c.useCostSignals ? " 且收益为正" : ""}：建议减仓 ${p(c.sell.rsiHot.min)} ~ ${p(c.sell.rsiHot.max)}`,
      ],
    },
  ];

  return (
    <details className={bare ? "group" : "glass fade-in group p-5 sm:p-8"} open={bare}>
      <summary className={bare ? "hidden" : "flex items-center justify-between"}>
        <div>
   <h2 className="text-lg font-semibold">策略说明</h2>
          <p className="mt-1 text-xs text-mute">信号从哪来：只用周线和月线，不看日内波动</p>
        </div>
        <span className="text-mute transition group-open:rotate-180">⌄</span>
      </summary>

      <div className={bare ? "grid gap-4" : "mt-6 grid gap-6 md:grid-cols-3"}>
        {rows.map((r) => (
          <div key={r.title}>
     <h3 className={`mb-2 text-sm font-semibold ${r.tone}`}>{r.title}</h3>
     <ul className="space-y-2 text-xs leading-relaxed text-sub">
       {r.items.map((t) => (
         <li key={t} className="flex gap-2">
           <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-mute" />
    <span>{t}</span>
         </li>
       ))}
            </ul>
   </div>
        ))}
      </div>

      <div className="mt-6 space-y-1.5 border-t border-line pt-4 text-xs leading-relaxed text-mute">
 <p>
   <b className="text-sub">今日结论优先级：</b>卖出 &gt; 风险暂停 &gt; 强烈买入 &gt; 适合加仓 &gt; 今日不宜操作。没有任何信号时默认「不宜操作」。
        </p>
        <p>
   <b className="text-sub">机会指数（0-100）：</b>各项买入条件得分相加，过热扣 {c.score.overheatPenalty} 分；≥ {c.thresholds.accumulateScore} 为适合加仓，≥ {c.thresholds.strongScore} 或周线 RSI &lt; {c.rsi.weeklyStrongBuy} 为强烈买入。
        </p>
        <p>
          <b className="text-sub">成本价：</b>加权平均，仅统计买入，手续费计入成本：Σ(价格 × 数量 + 手续费) ÷ Σ 数量。所有阈值在 strategy.config.ts 修改。
 </p>
      </div>
    </details>
  );
}
