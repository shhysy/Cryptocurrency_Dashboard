import manualJson from "@/data/manual-trades.json";
import { mergeTrades } from "@/strategy/cost";
import { applyTrackingStart } from "@/strategy/tracking";
import { trackingStart } from "@/tracking.config";
import { applyPostTakeProfitRebuy } from "@/strategy/post-take-profit-rebuy";
import { readTraderStrategyHistory } from "@/lib/execution/server/trader-status.server";
import type { Candle, Trade } from "@/strategy/types";
import { quote, watchlist } from "@/watchlist.config";
import {
  accountEnabled,
  fetchBalances,
  fetchBuyTrades,
  fetchFearGreed,
  fetchKlines,
  fetchTickers,
  fetchFuturesKlines,
  fetchFuturesTicker,
  fetchYahooQuote,
  fetchYahooWeekly,
  hasCredentials,
} from "./binance";
import { cached } from "./cache";
import { buildDashboard, STABLES, type RawData } from "./dashboard";
import { normalizeManual, type ManualRow } from "./manual";
import { buildMock } from "./mock";
import type { DashboardData } from "./types";

const MIN = 60_000;
const TTL = { ticker: 1 * MIN, account: 3 * MIN, klines: 30 * MIN, trades: 15 * MIN, fearGreed: 30 * MIN };

export async function getDashboard(opts: { scenario?: string } = {}): Promise<DashboardData> {
  const forceMock = process.env.USE_MOCK === "1";
  // 账户关闭时只读公开行情，不需要 Key；开启账户则必须有 Key
  if (forceMock || (accountEnabled() && !hasCredentials())) return buildMock_(opts.scenario);
  return buildReal();
}

function buildMock_(scenario?: string): DashboardData {
  const { raw, scenario: sc } = buildMock(scenario);
  return buildDashboard(raw, { source: "mock", updatedAt: Date.now(), scenario: sc });
}

async function buildReal(): Promise<DashboardData> {
  const account = accountEnabled();
  const spot = watchlist.filter((w) => !w.futures && !w.yahoo); // 币安现货
  const futures = watchlist.filter((w) => w.futures); // U 本位永续（如 CLUSDT），只出信号
  const outside = watchlist.filter((w) => w.yahoo && !w.futures); // Yahoo 备用
  const pairs = spot.map((w) => w.symbol + quote);
  const stamps: number[] = [];
  const errors: string[] = [];
  const track = <T,>(c: { value: T; at: number; stale: boolean; error?: string }) => {
    stamps.push(c.at);
    if (c.stale && c.error) errors.push(c.error);
    return c.value;
  };

  // 行情 + 账户并行；任一失败且无缓存会抛出，由上层 API 处理
  const [tickers, balances] = await Promise.all([
    cached("tickers", TTL.ticker, () => fetchTickers(pairs)).then(track),
    account
      ? cached("balances", TTL.account, fetchBalances).then(track)
      : Promise.resolve<Record<string, number>>({}),
  ]);

  // 恐惧贪婪指数是辅助项：取不到时按「无数据」处理，不让整个看板失败
  const fearGreed = await cached("fng", TTL.fearGreed, fetchFearGreed)
    .then(track)
    .catch(() => null);

  const weekly: Record<string, Candle[]> = {};
  const apiTrades: Trade[] = [];
  const outsideErrors: string[] = [];

  // Yahoo 品种：任何一步失败都只让该品种没数据，不影响其他币种
  await Promise.all(
    outside.map(async (w) => {
      const sym = w.yahoo as string;
      try {
        weekly[w.symbol] = await cached(`y1w:${sym}`, TTL.klines, () => fetchYahooWeekly(sym)).then(track);
        tickers[w.symbol + quote] = await cached(`yq:${sym}`, TTL.ticker, () => fetchYahooQuote(sym)).then(track);
      } catch (e) {
        weekly[w.symbol] ??= [];
        outsideErrors.push(`${w.name}：${e instanceof Error ? e.message.slice(0, 80) : "取数失败"}`);
      }
    }),
  );

  // 合约品种：公开行情，失败只影响该品种
  await Promise.all(
    futures.map(async (w) => {
      const pair = w.symbol + quote;
      try {
        const [wk, tk] = await Promise.all([
          cached(`f1w:${pair}`, TTL.klines, () => fetchFuturesKlines(pair, "1w", 400)).then(track),
          cached(`ftk:${pair}`, TTL.ticker, () => fetchFuturesTicker(pair)).then(track),
        ]);
        weekly[w.symbol] = wk;
        tickers[pair] = tk;
      } catch (e) {
        weekly[w.symbol] ??= [];
        outsideErrors.push(`${w.name}：${e instanceof Error ? e.message.slice(0, 80) : "合约行情失败"}`);
      }
    }),
  );

  await Promise.all(
    spot.map(async (w) => {
      const pair = w.symbol + quote;
      const [wk, tr] = await Promise.all([
        cached(`1w:${pair}`, TTL.klines, () => fetchKlines(pair, "1w", 400)).then(track),
        account
          ? cached(`trades:${pair}`, TTL.trades, () => fetchBuyTrades(w.symbol, quote)).then(track)
          : Promise.resolve<Trade[]>([]),
      ]);
      weekly[w.symbol] = wk;
      apiTrades.push(...tr);
    }),
  );

  const manual = normalizeManual(manualJson as ManualRow[]).trades;
  const merged = mergeTrades(apiTrades, manual);
  const heldNow = Object.fromEntries(watchlist.map((w) => [w.symbol, balances[w.symbol] ?? 0]));
  const priceNow = Object.fromEntries(watchlist.map((w) => [w.symbol, tickers[w.symbol + quote]?.price ?? 0]));

  // 只统计起算日之后的成交；起算日前已持有的部分用期初价补一条（见 tracking.config.ts）
  const start = Date.parse(`${trackingStart}T00:00:00Z`);
  const { trades, synthetic } = applyTrackingStart({
    trades: merged,
    start,
    balances: heldNow,
    weekly,
    prices: priceNow,
    symbols: watchlist.map((w) => w.symbol),
  });

  const raw: RawData = {
    tickers: Object.fromEntries(watchlist.map((w) => [w.symbol, tickers[w.symbol + quote]]).filter(([, v]) => v)),
    weekly,
    fearGreed,
    accountKnown: account,
    trades,
    balances: heldNow,
  };

  raw.extraAssets = Object.entries(balances)
    .filter(([, q]) => q > 0)
    .map(([asset, qty]) => {
      const px = STABLES.includes(asset) ? 1 : tickers[asset + quote]?.price;
      return { asset, qty, usdt: px === undefined ? null : qty * px };
    })
    .sort((a, b) => (b.usdt ?? -1) - (a.usdt ?? -1));

  const notes: string[] = [
    ...(futures.length
      ? [`${futures.map((w) => w.name).join("、")} 行情来自币安 U 本位永续（公开接口），只出信号，不读现货余额和成交。`]
      : []),
    ...(outside.length ? [`${outside.map((w) => w.name).join("、")} 的行情来自 Yahoo Finance，只出信号，不读余额和成交；币安现货没有该品种。`] : []),
    ...outsideErrors,
    `收益从 ${trackingStart} 起算，更早的买卖不计入（见 tracking.config.ts）。` +
      (synthetic.length ? `${synthetic.join("、")} 起算日前已持有，成本按起算日周线开盘价计，想用真实成本请在 data/manual-trades.json 手动填写。` : ""),
  ];

  const dashboard = buildDashboard(raw, {
    source: "binance",
    updatedAt: Math.min(...stamps),
    stale: errors.length > 0,
    staleReasons: [...new Set(errors)],
    notes,
  });
  // 服务端看板与本地Trader统一使用SQLite确认成交；绝不读取浏览器IndexedDB作为执行依据。
  const history = await readTraderStrategyHistory();
  return applyPostTakeProfitRebuy(
    dashboard,
    history?.sellEvents ?? [],
    history?.tradeLedger ?? [],
  );
}
