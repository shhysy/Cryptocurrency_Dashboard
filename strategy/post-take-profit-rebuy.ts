import { strategyConfig } from "../strategy.config";
import type { CoinCard, DashboardData } from "../lib/types";
import type { TradeLedgerEntry } from "../lib/execution/types";
import type { SellEventRecord } from "../lib/execution/sell-store.browser";
import type { Action, CoinSignal, Verdict } from "./types";
import { buildVerdict } from "./engine";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const EPSILON = 1e-8;

function noAction(over: Partial<Action> = {}): Action {
  return {
    kind: "add", label: "均价回补", side: "none", plannedUsdt: null, usdt: null,
    qty: null, sellPct: null, limits: [], blocked: [], notes: [], ...over,
  };
}

function isConfirmedTakeProfit(event: SellEventRecord): boolean {
  return event.kind === "take_profit" &&
    (event.status === "executed" ||
      (event.status === "partially_filled" && (event.filledQty ?? 0) > EPSILON));
}

function replayAverageCost(
  coin: CoinCard,
  sellFills: TradeLedgerEntry[],
): { qty: number; costUsdt: number; avgCost: number } | null {
  const events: { time: number; side: "BUY" | "SELL"; qty: number; costUsdt?: number }[] = [
    ...coin.buys.map((buy) => ({
      time: buy.t, side: "BUY" as const, qty: buy.qty, costUsdt: buy.costUsdt,
    })),
    ...sellFills.map((fill) => ({
      time: fill.time,
      side: "SELL" as const,
      qty: fill.qty + (fill.commissionAsset === coin.symbol ? fill.commission : 0),
    })),
  ].sort((a, b) => a.time - b.time || (a.side === "BUY" ? -1 : 1));

  let qty = 0;
  let costUsdt = 0;
  for (const event of events) {
    if (!Number.isFinite(event.qty) || event.qty <= 0) return null;
    if (event.side === "BUY") {
      if (!Number.isFinite(event.costUsdt) || (event.costUsdt ?? 0) <= 0) return null;
      qty += event.qty;
      costUsdt += event.costUsdt!;
    } else {
      if (event.qty > qty + EPSILON || qty <= EPSILON) return null;
      const avg = costUsdt / qty;
      qty = Math.max(0, qty - event.qty);
      costUsdt = Math.max(0, costUsdt - avg * event.qty);
    }
  }
  if (qty <= EPSILON || costUsdt <= EPSILON) return null;
  if (Math.abs(qty - coin.qty) > Math.max(EPSILON, coin.qty * 1e-6)) return null;
  return { qty, costUsdt, avgCost: costUsdt / qty };
}

/**
 * Once a confirmed take-profit tier has filled, replace the old head-price
 * ladder with a fresh four-tier ladder measured from the current average cost.
 * The override is client-side because confirmed sell-kind history lives in
 * browser IndexedDB, not in the server dashboard response.
 */
export function applyPostTakeProfitRebuy(
  data: DashboardData,
  sellEvents: SellEventRecord[],
  ledger: TradeLedgerEntry[],
): DashboardData {
  if (data.source !== "binance" || data.stale || !data.market.accountKnown) return data;

  const coins = data.coins.map((coin) => {
    if (coin.qty <= EPSILON || coin.avgCost === null) return coin;
    const symbolEvents = sellEvents.filter((event) => event.symbol === coin.symbol && isConfirmedTakeProfit(event));
    if (!symbolEvents.length) return coin;

    const tpIds = new Set(symbolEvents.flatMap((event) => event.fillIds));
    const tpFills = ledger.filter((fill) =>
      fill.symbol === coin.symbol + "USDT" && fill.side === "SELL" &&
      fill.sellKind === "take_profit" && tpIds.has(fill.fillId)
    );
    // If local sell-event history says TP happened but its fills are unavailable,
    // do not silently fall back to the old head-price ladder.
    if (tpFills.length === 0 || tpFills.length !== tpIds.size) {
      const action = noAction({
        label: "均价回补",
        blocked: ["已记录止盈，但本地止盈成交明细不完整；暂停回补信号，先恢复成交台账"],
      });
      return { ...coin, signal: { ...coin.signal, tag: "暂缓", kind: "none", action } };
    }

    const replay = replayAverageCost(coin, ledger.filter((fill) =>
      fill.symbol === coin.symbol + "USDT" && fill.side === "SELL"
    ));
    if (!replay) {
      const action = noAction({
        label: "均价回补",
        blocked: ["买卖成交无法与当前持仓数量核对；暂停均价回补，先核对持仓台账"],
      });
      return { ...coin, signal: { ...coin.signal, tag: "暂缓", kind: "none", action } };
    }

    const latestTpTime = Math.max(...tpFills.map((fill) => fill.time));
    const postTpBuys = coin.buys.filter((buy) => buy.t > latestTpTime);
    const tierIndex = postTpBuys.length;
    const profile = strategyConfig.profiles[coin.signal.group];
    const signal = coin.signal;
    const metrics = signal.metrics;
    const cfg = strategyConfig;
    const blocked: string[] = [];

    if (signal.score < profile.minScore) blocked.push(`分数 ${signal.score} 低于回补门槛 ${profile.minScore}`);
    if (metrics.stableCount === null || metrics.stableCount < profile.stabilizeMin) {
      blocked.push(`未企稳（${metrics.stableCount ?? 0}/${profile.stabilizeMin} 项）`);
    }
    if ((metrics.weeklyRsi !== null && metrics.weeklyRsi > cfg.rsi.overheat) ||
        (metrics.fearGreed !== null && metrics.fearGreed >= cfg.fearGreed.overheat)) {
      blocked.push("市场过热，暂停均价回补");
    }
    if (coin.signal.group === "alt" && data.market.btcState === "bear" && profile.bearBlocks) {
      blocked.push("BTC 熊市，山寨币禁止新增");
    }
    const latestBuy = coin.buys.filter((buy) => !buy.id.startsWith("opening-"))
      .reduce((latest, buy) => Math.max(latest, buy.t), 0);
    const cooldownWeeks = data.market.btcState === "bear" ? profile.cooldownBearWeeks : profile.cooldownWeeks;
    if (latestBuy > 0 && (data.updatedAt - latestBuy) / WEEK_MS < cooldownWeeks) {
      blocked.push(`冷却期未到（需 ≥ ${cooldownWeeks} 周）`);
    }

    if (tierIndex >= profile.adds.length) {
      const action = noAction({
        label: "均价回补已完成",
        notes: ["止盈后的 4 档均价回补已用完；本轮不再启用原头仓补仓或备用金"],
      });
      return {
        ...coin,
        avgCost: replay.avgCost,
        returnPct: coin.price / replay.avgCost - 1,
        signal: { ...signal, tag: "观望", kind: "none", action },
      };
    }

    const tier = profile.adds[tierIndex];
    const trigger = replay.avgCost * (1 - tier.drop);
    const factor = data.market.btcState === "bear" ? profile.bearFactor :
      data.market.btcState === "transition" ? profile.transitionFactor : 1;
    const plannedUsdt = tier.usdt * factor;
    const remainingCap = Math.max(0, profile.capUsdt - replay.costUsdt);
    const amount = Math.min(plannedUsdt, remainingCap);
    const limits = factor < 1 ? [`BTC ${data.market.btcState === "bear" ? "熊市" : "过渡市"}，金额 × ${factor}`] : [];
    if (amount < plannedUsdt) limits.push(`单币成本上限剩余 ${remainingCap.toFixed(2)} USDT`);
    if (amount < cfg.minOrderUsdt) blocked.push("单币额度剩余低于交易所最小下单额");

    let action: Action;
    if (blocked.length) {
      action = noAction({ label: `均价回补第 ${tierIndex + 1} 档`, plannedUsdt, limits, blocked });
    } else if (coin.price > trigger) {
      action = noAction({
        label: `均价回补第 ${tierIndex + 1} 档`,
        notes: [`触发价 ${trigger.toFixed(6)}（当前均价 ${replay.avgCost.toFixed(6)} 下跌 ${(tier.drop * 100).toFixed(0)}%），当前价格尚未到达`],
      });
    } else {
      action = {
        kind: "add",
        label: `均价回补第 ${tierIndex + 1} 档`,
        side: "buy",
        plannedUsdt,
        usdt: amount,
        qty: amount / coin.price,
        sellPct: null,
        limits,
        blocked: [],
        notes: [`止盈后按当前均价 ${replay.avgCost.toFixed(6)} 重新计算第 ${tierIndex + 1} 档触发价 ${trigger.toFixed(6)}`],
      };
    }

    const tag = action.side === "buy" ? "补仓" : action.blocked.length ? "暂缓" : "观望";
    const kind = action.side === "buy" ? (signal.score >= profile.highScore ? "strong" : "accumulate") : "none";
    return {
      ...coin,
      avgCost: replay.avgCost,
      returnPct: coin.price / replay.avgCost - 1,
      toDoublePct: Math.max(0, (replay.avgCost * 2) / coin.price - 1) * 100,
      doubleProgress: Math.min(1, Math.max(0, (coin.price / replay.avgCost - 1))),
      signal: { ...signal, tag, kind, action },
    };
  });

  const verdict = buildVerdict(coins.map((coin) => coin.signal));
  const totalInvested = coins.reduce((sum, coin) => sum + (coin.qty > 0 ? coin.avgCost! * coin.qty : 0), 0);
  const totalValue = coins.reduce((sum, coin) => sum + coin.marketValue, 0);
  const pnl = totalValue - totalInvested;
  return {
    ...data,
    coins,
    verdict,
    summary: {
      ...data.summary,
      totalInvested,
      pnl,
      pnlPct: totalInvested > 0 ? pnl / totalInvested : 0,
      investedCny: totalInvested * data.summary.usdtCny,
    },
  };
}
