/**
 * 浏览器端 Dashboard 装配。与 lib/service.ts 对应，但：
 * - 所有币安请求由浏览器直发，走用户宽带 IP（绕开 Cloudflare 被拉黑的问题）。
 * - 缓存改为 sessionStorage（页面关闭即失效，刷新保留，避免打爆币安限流）。
 * - 合约品种走 fapi 公开行情；Yahoo 仍会跨域被挡，直接跳过。
 */
import manualJson from "@/data/manual-trades.json";
import { mergeTrades } from "@/strategy/cost";
import { applyTrackingStart } from "@/strategy/tracking";
import { trackingStart } from "@/tracking.config";
import type { Candle, Trade } from "@/strategy/types";
import { quote, watchlist } from "@/watchlist.config";
import {
  fetchBalances,
  fetchBuyTrades,
  fetchFearGreed,
  fetchFuturesKlines,
  fetchFuturesTicker,
  fetchKlines,
  fetchTickers,
  hasCredentials,
} from "./binance.browser";
import { buildDashboard, STABLES, type RawData } from "./dashboard";
import { normalizeManual, type ManualRow } from "./manual";
import type { DashboardData } from "./types";

const MIN = 60_000;
const TTL = { ticker: 1 * MIN, account: 3 * MIN, klines: 30 * MIN, trades: 15 * MIN, fearGreed: 30 * MIN };

// 极简 sessionStorage 缓存：仅在失败时回退到上次成功值，并标记 stale。
interface Entry<T> {
  value: T;
  at: number;
}

function readCache<T>(key: string): Entry<T> | null {
  try {
    const raw = sessionStorage.getItem(`bn:${key}`);
    return raw ? (JSON.parse(raw) as Entry<T>) : null;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, v: Entry<T>) {
  try {
    sessionStorage.setItem(`bn:${key}`, JSON.stringify(v));
  } catch {
    /* quota or disabled */
  }
}

interface Cached<T> {
  value: T;
  at: number;
  stale: boolean;
  error?: string;
}

async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<Cached<T>> {
  const hit = readCache<T>(key);
  if (hit && Date.now() - hit.at < ttlMs) return { value: hit.value, at: hit.at, stale: false };
  try {
    const value = await fn();
    const at = Date.now();
    writeCache(key, { value, at });
    return { value, at, stale: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (hit) return { value: hit.value, at: hit.at, stale: true, error: msg };
    throw e;
  }
}

export async function getBrowserDashboard(): Promise<DashboardData> {
  if (!hasCredentials()) throw new Error("浏览器端未配置币安 Key");

  // 浏览器端：现货 + 合约公开行情；Yahoo 跨域不可用则跳过
  const spot = watchlist.filter((w) => !w.futures && !w.yahoo);
  const futures = watchlist.filter((w) => w.futures);
  const skippedOutside = watchlist.filter((w) => w.yahoo && !w.futures);
  const pairs = spot.map((w) => w.symbol + quote);

  const stamps: number[] = [];
  const errors: string[] = [];
  const track = <T,>(c: Cached<T>) => {
    stamps.push(c.at);
    if (c.stale && c.error) errors.push(c.error);
    return c.value;
  };

  const [tickers, balances] = await Promise.all([
    cached("tickers", TTL.ticker, () => fetchTickers(pairs)).then(track),
    cached("balances", TTL.account, fetchBalances).then(track),
  ]);

  const fearGreed = await cached("fng", TTL.fearGreed, fetchFearGreed)
    .then(track)
    .catch(() => null);

  const weekly: Record<string, Candle[]> = {};
  const apiTrades: Trade[] = [];

  // Yahoo 品种：浏览器端跳过，仅给一个空数组避免 UI 崩
  for (const w of skippedOutside) weekly[w.symbol] = [];

  // 合约公开行情（fapi，需与现货一样处理 CORS）
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
        errors.push(`${w.name}：${e instanceof Error ? e.message.slice(0, 80) : "合约行情失败"}`);
      }
    }),
  );

  await Promise.all(
    spot.map(async (w) => {
      const pair = w.symbol + quote;
      const [wk, tr] = await Promise.all([
        cached(`1w:${pair}`, TTL.klines, () => fetchKlines(pair, "1w", 400)).then(track),
        cached(`trades:${pair}`, TTL.trades, () => fetchBuyTrades(w.symbol, quote)).then(track),
      ]);
      weekly[w.symbol] = wk;
      apiTrades.push(...tr);
    }),
  );

  const manual = normalizeManual(manualJson as ManualRow[]).trades;
  const merged = mergeTrades(apiTrades, manual);
  const heldNow = Object.fromEntries(watchlist.map((w) => [w.symbol, balances[w.symbol] ?? 0]));
  const priceNow = Object.fromEntries(watchlist.map((w) => [w.symbol, tickers[w.symbol + quote]?.price ?? 0]));

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
    accountKnown: true,
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
      ? [`${futures.map((w) => w.name).join("、")} 行情来自币安 U 本位永续，只出信号。`]
      : []),
    ...(skippedOutside.length
      ? [`${skippedOutside.map((w) => w.name).join("、")} 浏览器直连模式下跳过（Yahoo 跨域不可用）。`]
      : []),
    `收益从 ${trackingStart} 起算，更早的买卖不计入。` +
      (synthetic.length ? `${synthetic.join("、")} 起算日前已持有，成本按起算日周线开盘价计。` : ""),
  ];

  return buildDashboard(raw, {
    source: "binance",
    updatedAt: stamps.length ? Math.min(...stamps) : Date.now(),
    stale: errors.length > 0,
    staleReasons: [...new Set(errors)],
    notes,
  });
}
