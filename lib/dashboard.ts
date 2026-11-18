import { strategyConfig } from "@/strategy.config";
import { isSignalOnly, quote, watchlist } from "@/watchlist.config";
import { computeCost } from "@/strategy/cost";
import { btcMarketState, buildVerdict, evaluateCoin, isCore } from "@/strategy/engine";
import type { Candle, Trade } from "@/strategy/types";
import type { CoinCard, DashboardData, Position, TradeRow } from "./types";

/** 成本价是否含手续费（见 strategy/cost.ts 的规则说明） */
export const INCLUDE_FEE = true;
export const STABLES = ["USDT", "USDC", "FDUSD", "BUSD"];

export interface RawData {
  tickers: Record<string, { price: number; change24h: number }>; // key = 基础币
  weekly: Record<string, Candle[]>;
  fearGreed?: number | null; // 恐惧贪婪指数，取不到为 null
  accountKnown?: boolean; // 是否读取了账户余额与成交（决定能否给出买入金额建议）
  trades: Trade[];
  balances?: Record<string, number>; // 真实持仓数量；没有则按成交累计
  extraAssets?: { asset: string; qty: number; usdt: number | null }[]; // 账户内全部非零资产
}

/** 买入时处于近 52 周价格区间的位置：0 = 最低，1 = 最高 */
function positionAt(weekly: Candle[], time: number, price: number): { position: Position; pct: number } {
  const past = weekly.filter((c) => c.t <= time).slice(-52);
  const slice = past.length >= 8 ? past : weekly.slice(0, 52);
  const lo = Math.min(price, ...slice.map((c) => c.l));
  const hi = Math.max(price, ...slice.map((c) => c.h));
  const pct = hi > lo ? (price - lo) / (hi - lo) : 0.5;
  return { position: pct <= 0.33 ? "low" : pct >= 0.66 ? "high" : "mid", pct };
}

export function buildDashboard(
  raw: RawData,
  meta: {
    source: "mock" | "binance";
    updatedAt: number;
    stale?: boolean;
    staleReasons?: string[];
    notes?: string[];
    scenario?: string;
  },
): DashboardData {
  const cfg = strategyConfig;

  // ---- 1. 成本与持仓 ----
  const base = watchlist.map((w) => {
    const trades = raw.trades.filter((t) => t.symbol === w.symbol);
    const cost = computeCost(trades, INCLUDE_FEE);
    const price = raw.tickers[w.symbol]?.price ?? raw.weekly[w.symbol]?.at(-1)?.c ?? 0;
    const rawQty = raw.balances?.[w.symbol] ?? cost.qty;
    // 折合不足 minAssetUsdt 的余额视为尘埃，不计入持仓
    const qty = rawQty * price >= cfg.minAssetUsdt ? rawQty : 0;
    return { w, trades, cost, price, qty, marketValue: qty * price };
  });

  const totalValue = base.reduce((s, b) => s + b.marketValue, 0);
  const totalInvested = base.reduce((s, b) => s + (b.qty > 0 ? b.cost.invested : 0), 0);
  const btcWeekly = raw.weekly.BTC ?? [];
  const btcPrice = raw.tickers.BTC?.price ?? btcWeekly.at(-1)?.c ?? 0;
  const btcState = btcMarketState(btcWeekly, btcPrice, cfg);
  const fearGreed = raw.fearGreed ?? null;
  const held = base.filter((b) => b.qty > 0);
  const cashUsdt = raw.balances?.USDT ?? raw.extraAssets?.find((asset) => asset.asset === "USDT")?.usdt ?? 0;
  const now = Date.now();
  const account = {
    known: Boolean(raw.accountKnown),
    cashUsdt,
    netWorthUsdt: cashUsdt + totalValue,
    coreCostUsdt: held.filter((b) => isCore(b.w.symbol, cfg)).reduce((s, b) => s + b.cost.invested, 0),
    altCostUsdt: held.filter((b) => !isCore(b.w.symbol, cfg)).reduce((s, b) => s + b.cost.invested, 0),
    altHeldCount: held.filter((b) => !isCore(b.w.symbol, cfg)).length,
    // 近 7 天新增买入：只算真实成交，起算日补的期初买入不算
    weeklyBuyUsdt: raw.trades
      .filter((t) => !t.id.startsWith("opening-") && now - t.time <= 7 * 864e5)
      .reduce((s, t) => s + t.price * t.qty + (INCLUDE_FEE ? t.fee : 0), 0),
  };
  const ctx = { fearGreed, btcState, account, now };

  // ---- 2. 信号与卡片 ----
  const coins: CoinCard[] = base.map(({ w, trades, cost, price, qty, marketValue }) => {
    const weekly = raw.weekly[w.symbol] ?? [];
    const avgCost = qty > 0 ? cost.avgCost : null;
    const signal = evaluateCoin(
      { symbol: w.symbol, price, weekly, qty, avgCost, invested: cost.invested, marketValue, buys: trades, signalOnly: isSignalOnly(w) },
      ctx,
      cfg,
    );
    const returnPct = avgCost ? price / avgCost - 1 : null;
    const target = cfg.sell.levels[0].ret;
    return {
      symbol: w.symbol,
      name: w.name,
      color: w.color,
      price,
      change24h: raw.tickers[w.symbol]?.change24h ?? 0,
      qty,
      marketValue,
      avgCost,
      invested: cost.invested,
      returnPct,
      toDoublePct: avgCost ? Math.max(0, (avgCost * target) / price - 1) * 100 : null,
      doubleProgress: avgCost && returnPct !== null ? Math.min(1, Math.max(0, returnPct / target)) : 0,
      series: weekly.slice(-104).map((c, i, arr) => ({ t: c.t, c: i === arr.length - 1 && price ? price : c.c })),
      buys: trades.map((t) => ({
        id: t.id,
        t: t.time,
        price: t.price,
        qty: t.qty,
        position: positionAt(weekly, t.time, t.price).position,
      })),
      signal,
    };
  });

  // ---- 3. 成交明细 ----
  const trades: TradeRow[] = raw.trades
    .map((t) => {
      const price = raw.tickers[t.symbol]?.price ?? raw.weekly[t.symbol]?.at(-1)?.c ?? t.price;
      const pos = positionAt(raw.weekly[t.symbol] ?? [], t.time, t.price);
      return {
        id: t.id,
        symbol: t.symbol,
        time: t.time,
        price: t.price,
        qty: t.qty,
        amount: t.price * t.qty + (INCLUDE_FEE ? t.fee : 0),
        pnlPct: price / t.price - 1,
        pnlUsdt: (price - t.price) * t.qty,
        position: pos.position,
        positionPct: pos.pct,
        source: t.source,
      };
    })
    .sort((a, b) => b.time - a.time);

  // ---- 4. 资产曲线（按周，由买入记录回放） ----
  const allWeeks = new Set<number>();
  Object.values(raw.weekly).forEach((arr) => arr.forEach((c) => allWeeks.add(c.t)));
  const firstTrade = raw.trades.length ? Math.min(...raw.trades.map((t) => t.time)) : Infinity;
  const weeks = [...allWeeks].sort((a, b) => a - b).filter((t) => t + 7 * 864e5 >= firstTrade);
  const equityCurve = weeks.map((t) => {
    let value = 0;
    let invested = 0;
    for (const w of watchlist) {
      const bought = raw.trades.filter((x) => x.symbol === w.symbol && x.time < t + 7 * 864e5);
      if (!bought.length) continue;
      const q = bought.reduce((s, x) => s + x.qty, 0);
      invested += bought.reduce((s, x) => s + x.price * x.qty + (INCLUDE_FEE ? x.fee : 0), 0);
      const c = raw.weekly[w.symbol]?.find((k) => k.t === t);
      value += q * (c?.c ?? 0);
    }
    return { t, value, invested };
  });
  if (equityCurve.length) {
    const last = equityCurve[equityCurve.length - 1];
    last.value = totalValue || last.value;
    last.invested = totalInvested || last.invested;
  }

  const pnl = totalValue - totalInvested;
  const verdict = buildVerdict(coins.map((c) => c.signal));

  return {
    source: meta.source,
    scenario: meta.scenario,
    updatedAt: meta.updatedAt,
    stale: Boolean(meta.stale),
    staleReasons: meta.staleReasons ?? [],
    notes: meta.notes ?? [],
    // 折合不足 minAssetUsdt 的不显示；查不到 USDT 价格的（如 LD 开头的理财凭证）也不显示
    account: { assets: (raw.extraAssets ?? []).filter((a) => a.usdt !== null && a.usdt >= cfg.minAssetUsdt), cashUsdt },
    summary: {
      totalAssets: totalValue + cashUsdt,
      totalValue,
      totalInvested,
      pnl,
      pnlPct: totalInvested > 0 ? pnl / totalInvested : 0,
      investedCny: totalInvested * cfg.risk.usdtCny,
      usdtCny: cfg.risk.usdtCny,
    },
    equityCurve,
    allocation: coins
      .filter((c) => c.marketValue > 0)
      .map((c) => ({ symbol: c.symbol, color: c.color, value: c.marketValue, weight: totalValue ? c.marketValue / totalValue : 0 })),
    coins,
    trades,
    verdict,
    market: { fearGreed, btcState, accountKnown: account.known },
    config: {
      doubleLine: cfg.sell.levels[0].ret,
      mailScoreCore: Number(
        process.env.MAIL_MIN_SCORE_CORE ?? process.env.NEXT_PUBLIC_MAIL_MIN_SCORE_CORE ?? 55,
      ),
      mailScoreAlt: Number(
        process.env.MAIL_MIN_SCORE_ALT ?? process.env.NEXT_PUBLIC_MAIL_MIN_SCORE_ALT ?? 75,
      ),
    },
  };
}

export const QUOTE = quote;
