import { strategyConfig as c } from "@/strategy.config";

const p = (x: number) => `${Math.round(x * 100)}%`;

export default function StrategyInfo({ bare = false }: { bare?: boolean }) {
  const core = c.profiles.core;
  const alt = c.profiles.alt;
  const pf = c.portfolio;
  const rows: { title: string; items: string[]; tone: string }[] = [
    {
      title: `打分（满分 ${c.scoreMax}）`,
      tone: "text-up",
      items: [
        `价格位置（≤ ${c.score.pricePositionCap}）：周线 RSI(${c.rsi.period}) ${c.rsi.tiers.map((t) => `≤ ${t.max} 得 ${t.points}`).join(" / ")}；价格/周线 MA${c.ma.weeklyPeriod} ${c.ma.tiers.map((t) => `≤ ${t.max} 得 ${t.points}`).join(" / ")}。两项取较高者 + 较低者 × ${c.score.pricePositionDiscount}，避免重复计分`,
        `情绪（≤ 30）：恐惧贪婪指数 ${c.fearGreed.tiers.map((t) => `≤ ${t.max} 得 ${t.points}`).join(" / ")}`,
        `趋势结构（≤ 15）：企稳每满足 1 项得 ${c.score.trendPerItem} 分`,
        `企稳 3 项：①收盘 > 上周最高价 ②RSI < ${c.rsi.stabilizeBelow} 且较上周回升 ③近 4 周最低价未低于此前 8 周最低价`,
      ],
    },
    {
      title: `买入（${c.coreSymbols.join(" / ")} 为积极型，其余为保守型）`,
      tone: "text-gold",
      items: [
        `买入门槛：积极型 ≥ ${core.minScore} 分且企稳 ≥ ${core.stabilizeMin} 项；保守型 ≥ ${alt.minScore} 分且企稳 ${alt.stabilizeMin} 项`,
        `头仓：积极型 $${core.headNormal}（≥ ${core.highScore} 分且 BTC 非熊市 $${core.headHigh}）；保守型 $${alt.headNormal}（≥ ${alt.highScore} 分 $${alt.headHigh}）`,
        `头仓认定：单笔买入 > $${c.headMinUsdt}，或持有余额折合 > $${c.headMinUsdt}；之前的小额买入不算。补仓档位 = 头仓之后又买了几笔`,
        `补仓 4 档（较头仓价下跌）：积极型 ${core.adds.map((a) => p(a.drop)).join(" / ")} 各 $${core.adds[0].usdt}；保守型 ${alt.adds.map((a) => p(a.drop)).join(" / ")} 各 $${alt.adds[0].usdt}`,
        `备用金：积极型 $${core.reserve.usdt}（跌 ${p(core.reserve.drop)}）；保守型 $${alt.reserve.usdt}（跌 ${p(alt.reserve.drop)}）。另需恐惧贪婪 ≤ ${c.fearGreed.extremeFear} 且企稳 ≥ ${c.reserveStableMin} 项`,
        `BTC 过渡市金额 × ${core.transitionFactor}（保守型 × ${alt.transitionFactor}），熊市 × ${core.bearFactor}（保守型 × ${alt.bearFactor}，且禁止新增）。冷却：积极型 ${core.cooldownWeeks} 周，保守型 ${alt.cooldownWeeks} 周`,
      ],
    },
    {
      title: "固定额度（不按账户规模）",
      tone: "text-sub",
      items: [
        `单币剩余持仓成本上限：积极型 ${core.capUsdt}，保守型 ${alt.capUsdt}`,
        `最多同时持有 ${pf.altMaxCount} 个山寨币；不再按账户净值、最低现金比例或每周净值比例缩减计划金额`,
        "买入资金只使用 Binance 现货 USDT free；余额不足时允许部分买入，未买金额保留在待买队列",
        `最小下单金额约 ${c.minOrderUsdt}，最终还需通过 Binance 数量步长、最小名义金额和交易对状态校验`,
      ],
    },
    {
      title: "卖出",
      tone: "text-down",
      items: [
        `止盈：按顺序触发 ×2 卖当前周期仓 50%、×3 再卖当前周期仓 30%、×5 再卖当前周期仓 80%；同一档只执行一次`,
        `指标止盈：周线 RSI > ${c.rsi.overheat} 或恐惧贪婪 ≥ ${c.fearGreed.overheat}，且价格高于均价：卖周期仓的 ${p(c.indicatorProfit.sellRatio)}`,
        `追踪止损：价格曾达均价 × ${core.trailStart}（保守型 × ${alt.trailStart}）后，自峰值回撤 ${p(core.trailDrawdown)}（保守型 ${p(alt.trailDrawdown)}）退出周期仓`,
        `底仓：累计买入量的 ${p(core.baseRatio)}（保守型 ${p(alt.baseRatio)}）锁定不卖；价格 ≥ 均价 × ${c.baseReduce.mult} 且 RSI > ${c.baseReduce.rsi}、恐惧贪婪过热时，才减底仓的 ${p(c.baseReduce.ratio)}`,
      ],
    },
  ];

  return (
    <details className={bare ? "group" : "glass fade-in group p-5 sm:p-8"} open={bare}>
      <summary className={bare ? "hidden" : "flex items-center justify-between"}>
        <div>
   <h2 className="text-lg font-semibold">策略说明</h2>
          <p className="mt-1 text-xs text-mute">信号从哪来：周线 RSI、周线 MA200 和恐惧贪婪指数，不看日内波动</p>
        </div>
        <span className="text-mute transition group-open:rotate-180">⌄</span>
      </summary>

      <div className={bare ? "grid gap-4" : "mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-4"}>
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
   <b className="text-sub">今日结论优先级：</b>减仓 &gt; 强烈买入 &gt; 适合加仓 &gt; 今日不宜操作。没有任何信号时默认「不宜操作」。
        </p>
        <p>
          <b className="text-sub">止盈后回补：</b>任意止盈档确认成交后，旧头仓价补仓和备用金关闭；只按当前均价重新执行 4 档回补。持仓归零后下一轮恢复头仓规则。
        </p>
        <p>
          <b className="text-sub">成本价：</b>按买卖成交回放加权平均成本；卖出按卖出前均价扣减持仓成本，回补买入后重新计算。所有阈值在 strategy.config.ts 修改。
        </p>
      </div>
    </details>
  );
}
