import manualJson from "@/data/manual-trades.json";
import { mergeTrades } from "@/strategy/cost";
import { applyTrackingStart } from "@/strategy/tracking";
import { trackingStart } from "@/tracking.config";
import type { Candle, Trade } from "@/strategy/types";
import { quote, watchlist } from "@/watchlist.config";
import { fetchBalances, fetchBuyTrades, fetchKlines, fetchTickers, hasCredentials } from "./binance";
import { cached } from "./cache";
import { buildDashboard, STABLES, type RawData } from "./dashboard";
import { normalizeManual, type ManualRow } from "./manual";
import { buildMock } from "./mock";
import type { DashboardData } from "./types";

const MIN = 60_000;
const TTL = { ticker: 1 * MIN, account: 3 * MIN, klines: 30 * MIN, trades: 15 * MIN };

export async function getDashboard(opts: { scenario?: string } = {}): Promise<DashboardData> {
  const forceMock = process.env.USE_MOCK === "1";
  if (forceMock || !hasCredentials()) return buildMock_(opts.scenario);
  return buildReal();
}

function buildMock_(scenario?: string): DashboardData {
  const { raw, scenario: sc } = buildMock(scenario);
  return buildDashboard(raw, { source: "mock", updatedAt: Date.now(), scenario: sc });
}

async function buildReal(): Promise<DashboardData> {
  const pairs = watchlist.map((w) => w.symbol + quote);
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
    cached("balances", TTL.account, fetchBalances).then(track),
  ]);

  const weekly: Record<string, Candle[]> = {};
  const monthly: Record<string, Candle[]> = {};
  const apiTrades: Trade[] = [];
  await Promise.all(
    watchlist.map(async (w) => {
      const pair = w.symbol + quote;
      const [wk, mo, tr] = await Promise.all([
        cached(`1w:${pair}`, TTL.klines, () => fetchKlines(pair, "1w", 400)).then(track),
 cached(`1M:${pair}`, TTL.klines, () => fetchKlines(pair, "1M", 120)).then(track),
        cached(`trades:${pair}`, TTL.trades, () => fetchBuyTrades(w.symbol, quote)).then(track),
      ]);
      weekly[w.symbol] = wk;
      monthly[w.symbol] = mo;
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
    monthly,
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
    `收益从 ${trackingStart} 起算，更早的买卖不计入（见 tracking.config.ts）。` +
      (synthetic.length ? `${synthetic.join("、")} 起算日前已持有，成本按起算日周线开盘价计，想用真实成本请在 data/manual-trades.json 手动填写。` : ""),
  ];

  return buildDashboard(raw, {
    source: "binance",
    updatedAt: Math.min(...stamps),
    stale: errors.length > 0,
    staleReasons: [...new Set(errors)],
    notes,
  });
}
