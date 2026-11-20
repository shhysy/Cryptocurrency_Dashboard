import { strategyConfig } from "../strategy.config";
import type { CoinCard, DashboardData } from "../lib/types";
import type { TradeLedgerEntry } from "../lib/execution/types";
import type { SellEventRecord } from "../lib/execution/sell-store.browser";
import type { Action, CoinSignal } from "./types";
import { buildVerdict, calculateTakeProfitQty } from "./engine";

const WEEK_MS = 7 * 864e5;
const EPSILON = 1e-8;

function noAction(label: string, over: Partial<Action> = {}): Action {
  return {
    kind: "none", label, side: "none", plannedUsdt: null, usdt: null,
    qty: null, sellPct: null, limits: [], blocked: [], notes: [], ...over,
  };
}

function confirmed(event: SellEventRecord): boolean {
  return event.status === "executed" ||
    (event.status === "partially_filled" && (event.filledQty ?? 0) > EPSILON);
}

function tierOf(event: SellEventRecord): number | null {
  const match = event.eventKey.match(/:止盈([1-3])$/);
  return match ? Number(match[1]) : null;
}

interface AverageReplay {
  qty: number;
  costUsdt: number;
  avgCost: number;
  lastFlatAt: number | null;
}

function replayAverageCost(coin: CoinCard, sells: TradeLedgerEntry[]): AverageReplay | null {
  const events: { time: number; side: "BUY" | "SELL"; qty: number; costUsdt?: number }[] = [
    ...coin.buys.map((buy) => ({
      time: buy.t, side: "BUY" as const, qty: buy.qty, costUsdt: buy.costUsdt ?? buy.price * buy.qty,
    })),
    ...sells.map((fill) => ({
      time: fill.time,
      side: "SELL" as const,
      qty: fill.qty + (fill.commissionAsset === coin.symbol ? fill.commission : 0),
    })),
  ].sort((a, b) => a.time - b.time || (a.side === "BUY" ? -1 : 1));

  let qty = 0;
  let costUsdt = 0;
  let lastFlatAt: number | null = null;
  for (const event of events) {
    if (!Number.isFinite(event.qty) || event.qty <= 0) return null;
    if (event.side === "BUY") {
      if (!Number.isFinite(event.costUsdt) || (event.costUsdt ?? 0) <= 0) return null;
      qty += event.qty;
      costUsdt += event.costUsdt!;
    } else {
      if (event.qty > qty + EPSILON || qty <= EPSILON) return null;
      const average = costUsdt / qty;
      qty = Math.max(0, qty - event.qty);
      costUsdt = Math.max(0, costUsdt - average * event.qty);
      if (qty <= EPSILON) {
        qty = 0;
        costUsdt = 0;
        lastFlatAt = event.time;
      }
    }
  }
  if (qty <= EPSILON || costUsdt <= EPSILON) return null;
  if (Math.abs(qty - coin.qty) > Math.max(EPSILON, coin.qty * 1e-6)) return null;
  return { qty, costUsdt, avgCost: costUsdt / qty, lastFlatAt };
}

function blockedSignal(coin: CoinCard, reason: string): CoinCard {
  const action = noAction("均价回补", { blocked: [reason] });
  return { ...coin, signal: { ...coin.signal, kind: "none" as const, tag: "暂缓" as const, action } };
}

/**
 * Replays the browser's exchange-confirmed SELL ledger against dashboard BUY
 * fills. It then enforces sequential 2x/3x/5x take-profit tiers and, after
 * the first confirmed TP in the current holding round, replaces head-price
 * adds/reserve with four average-cost rebuy tiers.
 */
export function applyPostTakeProfitRebuy(
  data: DashboardData,
  sellEvents: SellEventRecord[],
  ledger: TradeLedgerEntry[],
): DashboardData {
  if (data.source !== "binance" || data.stale || !data.market.accountKnown) return data;

  const coins: CoinCard[] = data.coins.map((coin): CoinCard => {
    if (coin.qty <= EPSILON || coin.avgCost === null) return coin;
    const pair = coin.symbol + "USDT";
    const symbolEvents = sellEvents.filter((event) => event.symbol === coin.symbol);
    const symbolSells = ledger.filter((fill) =>
      fill.symbol === pair && fill.side === "SELL"
    );
    const replay = replayAverageCost(coin, symbolSells);
    const tpEvents = symbolEvents.filter((event) => event.kind === "take_profit" && confirmed(event));
    const tpIds = new Set(tpEvents.flatMap((event) => event.fillIds));
    const tpFills = symbolSells.filter((fill) =>
      fill.sellKind === "take_profit" && tpIds.has(fill.fillId)
    );

    if (tpEvents.length && (tpFills.length === 0 || tpFills.length !== tpIds.size)) {
      return blockedSignal(coin, "已记录止盈，但止盈成交明细不完整；暂停回补，先恢复成交台账");
    }
    if (tpEvents.length && !replay) {
      return blockedSignal(coin, "买卖成交无法与当前持仓数量核对；暂停止盈后回补，先核对持仓台账");
    }
    if (!replay) return blockedSignal(coin, "买入记录与当前持仓数量无法核对；无法可靠判断止盈状态和均价，暂停本币策略操作");

    const profile = strategyConfig.profiles[coin.signal.group];
    const avgCost = replay.avgCost;
    const returnPct = coin.price / avgCost - 1;
    const signal = coin.signal;

    // The three TP tiers are strictly sequential. A later price target cannot
    // skip an earlier tier. Each tier targets a fraction of the initial cycle
    // inventory for this holding round, capped by the currently remaining cycle quantity.
    const currentRoundTpFills = replay.lastFlatAt === null
      ? tpFills
      : tpFills.filter((fill) => fill.time > replay.lastFlatAt!);
    const currentRoundTpIds = new Set(currentRoundTpFills.map((fill) => fill.fillId));
    const currentRoundTpEvents = tpEvents.filter((event) =>
      event.fillIds.some((fillId) => currentRoundTpIds.has(fillId))
    );
    const doneTiers = new Set(
      currentRoundTpEvents.map(tierOf).filter((tier): tier is number => tier !== null),
    );
    const nextTier = [1, 2, 3].find((tier) => !doneTiers.has(tier));
    const roundStart = replay.lastFlatAt ?? Number.NEGATIVE_INFINITY;
    const baseReduced = symbolSells
      .filter((fill) => fill.sellKind === "base_reduce" && fill.time > roundStart)
      .reduce((sum, fill) => sum + fill.qty +
        (fill.commissionAsset === coin.symbol ? fill.commission : 0), 0);
    const boughtQty = coin.buys
      .filter((buy) => buy.t > roundStart)
      .reduce((sum, buy) => sum + buy.qty, 0);
    const protectedBaseQty = Math.max(0, boughtQty * profile.baseRatio - baseReduced);
    const cycleQty = Math.max(0, coin.qty - protectedBaseQty);

    if (nextTier !== undefined) {
      const tp = profile.takeProfit[nextTier - 1];
      const trigger = avgCost * tp.mult;
      const initialCycleQty = Math.max(0, boughtQty * (1 - profile.baseRatio));
      if (coin.price >= trigger && cycleQty > EPSILON) {
        const qty = calculateTakeProfitQty(initialCycleQty, cycleQty, tp.ratio);
        const action: Action = {
          kind: "takeProfit", label: `止盈${nextTier}`, side: "sell",
          plannedUsdt: null, usdt: qty * coin.price, qty,
          sellPct: qty / coin.qty, limits: [], blocked: [],
          notes: [`价格达到当前均价 × ${tp.mult}；本档目标为本轮初始周期仓的 ${Math.round(tp.ratio * 100)}%，最多卖出剩余周期仓`],
        };
        return {
          ...coin, avgCost, returnPct,
          toDoublePct: Math.max(0, (avgCost * 2) / coin.price - 1) * 100,
          doubleProgress: Math.min(1, Math.max(0, returnPct)),
          signal: { ...signal, kind: "sell" as const, tag: "止盈" as const, action },
        };
      }
    }

    // A confirmed TP activates the rebuy mode only for the same holding round.
    // If the position previously reached zero, the next holding round starts fresh.
    const firstTpTime = currentRoundTpFills.length ? Math.min(...currentRoundTpFills.map((fill) => fill.time)) : null;
    const postTpMode = firstTpTime !== null &&
      (replay.lastFlatAt === null || replay.lastFlatAt < firstTpTime);

    if (postTpMode) {
      const postTpBuys = coin.buys.filter((buy) => buy.t > firstTpTime);
      const tierIndex = new Set(postTpBuys.map((buy) => buy.orderId ?? buy.id)).size;
      const blocked: string[] = [];
      const metrics = signal.metrics;
      const cfg = strategyConfig;

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
        const action = noAction("均价回补已完成", {
          notes: ["止盈后的 4 档均价回补已用完；原头仓价补仓和备用金不再恢复"],
        });
        return { ...coin, avgCost, returnPct, signal: { ...signal, kind: "none", tag: "观望", action } };
      }

      const tier = profile.adds[tierIndex];
      const trigger = avgCost * (1 - tier.drop);
      const factor = data.market.btcState === "bear" ? profile.bearFactor :
        data.market.btcState === "transition" ? profile.transitionFactor : 1;
      const plannedUsdt = tier.usdt * factor;
      const remainingCap = Math.max(0, profile.capUsdt - replay.costUsdt);
      const amount = Math.min(plannedUsdt, remainingCap);
      const limits = factor < 1
        ? [`BTC ${data.market.btcState === "bear" ? "熊市" : "过渡市"}，金额 × ${factor}`]
        : [];
      if (amount < plannedUsdt) limits.push(`单币成本上限剩余 ${remainingCap.toFixed(2)} USDT`);
      if (amount < cfg.minOrderUsdt) blocked.push("单币额度剩余低于最小下单额");

      let action: Action;
      if (blocked.length) {
        action = noAction(`均价回补第 ${tierIndex + 1} 档`, { plannedUsdt, limits, blocked });
      } else if (coin.price > trigger) {
        action = noAction(`均价回补第 ${tierIndex + 1} 档`, {
          notes: [`触发价 ${trigger.toFixed(6)}（当前均价 ${avgCost.toFixed(6)} 下跌 ${(tier.drop * 100).toFixed(0)}%），当前价格尚未到达`],
        });
      } else {
        action = {
          kind: "add", label: `均价回补第 ${tierIndex + 1} 档`, side: "buy",
          plannedUsdt, usdt: amount, qty: amount / coin.price, sellPct: null,
          limits, blocked: [],
          notes: [`止盈后按当前均价 ${avgCost.toFixed(6)} 重新计算第 ${tierIndex + 1} 档`],
        };
      }
      const tag: CoinSignal["tag"] = action.side === "buy" ? "补仓" : action.blocked.length ? "暂缓" : "观望";
      const kind: CoinSignal["kind"] = action.side === "buy"
        ? (signal.score >= profile.highScore ? "strong" : "accumulate")
        : "none";
      return {
        ...coin, avgCost, returnPct,
        toDoublePct: Math.max(0, (avgCost * 2) / coin.price - 1) * 100,
        doubleProgress: Math.min(1, Math.max(0, returnPct)),
        signal: { ...signal, kind, tag, action },
      };
    }

    return {
      ...coin, avgCost, returnPct,
      toDoublePct: Math.max(0, (avgCost * 2) / coin.price - 1) * 100,
      doubleProgress: Math.min(1, Math.max(0, returnPct)),
    };
  });

  const verdict = buildVerdict(coins.map((coin) => coin.signal));
  const totalInvested = coins.reduce((sum, coin) => sum + (coin.qty > 0 && coin.avgCost ? coin.avgCost * coin.qty : 0), 0);
  const totalValue = coins.reduce((sum, coin) => sum + coin.marketValue, 0);
  const pnl = totalValue - totalInvested;
  return {
    ...data, coins, verdict,
    summary: {
      ...data.summary, totalInvested, pnl,
      pnlPct: totalInvested > 0 ? pnl / totalInvested : 0,
      investedCny: totalInvested * data.summary.usdtCny,
    },
  };
}
