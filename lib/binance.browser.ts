/**
 * 币安接口 · 浏览器直连版。
 *
 * 用途：部署在 Cloudflare 后，Workers 出口 IP 被币安拉黑；改用用户浏览器直连，
 * 让币安看到的是用户本机宽带 IP。公开行情同样走 api.binance.com（需 CORS Unblock 插件配合）。
 *
 * 安全：Key/Secret 写在 lib/credentials.ts 并打进前端 bundle。
 * 只给自己用，并务必在币安后台给 Key 设 IP 白名单（只允许你家 IP），避免 bundle 泄露被滥用。
 */
import type { Candle, Trade } from "@/strategy/types";
import { FALLBACK_BINANCE_API_KEY, FALLBACK_BINANCE_API_SECRET } from "./credentials";

// NEXT_PUBLIC_* 会被打包到客户端，浏览器直连模式无法对使用者隐藏 Secret。
const API_KEY = process.env.NEXT_PUBLIC_BINANCE_API_KEY || FALLBACK_BINANCE_API_KEY;
const API_SECRET = process.env.NEXT_PUBLIC_BINANCE_API_SECRET || FALLBACK_BINANCE_API_SECRET;
const BASE = "https://api.binance.com";

async function getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Binance ${res.status}: ${body.slice(0, 160)}`);
  }
  return res.json() as Promise<T>;
}

export function hasCredentials() {
  return Boolean(API_KEY && API_SECRET);
}

async function hmacHex(secret: string, message: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 时钟同步。浏览器时钟不准会触发 -1021。
let clockOffset: number | null = null;
let clockSyncedAt = 0;
async function serverNow(): Promise<number> {
  if (clockOffset === null || Date.now() - clockSyncedAt > 30 * 60_000) {
    const t0 = Date.now();
    const { serverTime } = await getJson<{ serverTime: number }>(`${BASE}/api/v3/time`);
    const t1 = Date.now();
    clockOffset = serverTime - (t0 + t1) / 2;
    clockSyncedAt = t1;
  }
  return Date.now() + clockOffset;
}

async function signedGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(
    Object.entries({ ...params, recvWindow: 10000, timestamp: Math.round(await serverNow()) }).map(([k, v]) => [k, String(v)]),
  ).toString();
  const signature = await hmacHex(API_SECRET, qs);
  return getJson<T>(`${BASE}${path}?${qs}&signature=${signature}`, { "X-MBX-APIKEY": API_KEY });
}

// ---------- 公开行情 ----------
export interface Ticker {
  price: number;
  change24h: number;
}

export async function fetchTickers(pairs: string[]): Promise<Record<string, Ticker>> {
  const symbols = encodeURIComponent(JSON.stringify(pairs));
  const rows = await getJson<{ symbol: string; lastPrice: string; priceChangePercent: string }[]>(
    `${BASE}/api/v3/ticker/24hr?symbols=${symbols}&type=MINI`,
  );
  const out: Record<string, Ticker> = {};
  for (const r of rows) out[r.symbol] = { price: Number(r.lastPrice), change24h: Number(r.priceChangePercent) / 100 };
  return out;
}

export async function fetchKlines(pair: string, interval: "1w", limit: number): Promise<Candle[]> {
  const rows = await getJson<(string | number)[][]>(`${BASE}/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`);
  return rows.map((r) => ({
    t: Number(r[0]),
    o: Number(r[1]),
    h: Number(r[2]),
    l: Number(r[3]),
    c: Number(r[4]),
    v: Number(r[5]),
  }));
}

export async function fetchFearGreed(): Promise<number> {
  const j = await getJson<{ data: { value: string }[] }>("https://api.alternative.me/fng/?limit=1");
  const v = Number(j.data?.[0]?.value);
  if (!Number.isFinite(v)) throw new Error("Fear&Greed: bad response");
  return v;
}

// ---------- U 本位合约公开行情 ----------
const FAPI = "https://fapi.binance.com";

export async function fetchFuturesTicker(pair: string): Promise<Ticker> {
  const r = await getJson<{ lastPrice: string; priceChangePercent: string }>(
    `${FAPI}/fapi/v1/ticker/24hr?symbol=${pair}`,
  );
  return { price: Number(r.lastPrice), change24h: Number(r.priceChangePercent) / 100 };
}

export async function fetchFuturesKlines(pair: string, interval: "1w", limit: number): Promise<Candle[]> {
  const rows = await getJson<(string | number)[][]>(
    `${FAPI}/fapi/v1/klines?symbol=${pair}&interval=${interval}&limit=${limit}`,
  );
  return rows.map((r) => ({
    t: Number(r[0]),
    o: Number(r[1]),
    h: Number(r[2]),
    l: Number(r[3]),
    c: Number(r[4]),
    v: Number(r[5]),
  }));
}

// Yahoo 在国内直连大概率也被挡，这里保留接口但默认不调用（由 service.browser.ts 决定是否启用）。
interface YahooChart {
  chart: {
    result?: {
      meta: { regularMarketPrice: number };
      timestamp?: number[];
      indicators: { quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[] };
    }[];
  };
}
const yahooUrl = (sym: string, interval: string, range: string) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`;

export async function fetchYahooWeekly(sym: string): Promise<Candle[]> {
  const j = await getJson<YahooChart>(yahooUrl(sym, "1wk", "10y"));
  const r = j.chart.result?.[0];
  const q = r?.indicators.quote[0];
  if (!r?.timestamp || !q) throw new Error(`Yahoo ${sym}: no data`);
  const out: Candle[] = [];
  r.timestamp.forEach((ts, i) => {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if (o == null || h == null || l == null || c == null) return;
    out.push({ t: ts * 1000, o, h, l, c, v: q.volume[i] ?? 0 });
  });
  if (out.length < 2) throw new Error(`Yahoo ${sym}: too few candles`);
  return out;
}

export async function fetchYahooQuote(sym: string): Promise<Ticker> {
  const j = await getJson<YahooChart>(yahooUrl(sym, "1d", "5d"));
  const r = j.chart.result?.[0];
  const closes = (r?.indicators.quote[0].close ?? []).filter((x): x is number => x != null);
  if (!r || closes.length < 2) throw new Error(`Yahoo ${sym}: no quote`);
  const price = r.meta.regularMarketPrice;
  return { price, change24h: price / closes[closes.length - 2] - 1 };
}

// ---------- 账户（只读） ----------
export async function fetchBalances(): Promise<Record<string, number>> {
  const acc = await signedGet<{ balances: { asset: string; free: string; locked: string }[] }>("/api/v3/account", {
    omitZeroBalances: "true",
  });
  return mergeEarnBalances(acc.balances);
}

export function mergeEarnBalances(balances: { asset: string; free: string; locked: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of balances) {
    const asset = /^LD[A-Z0-9]{2,}$/.test(b.asset) ? b.asset.slice(2) : b.asset;
    out[asset] = (out[asset] ?? 0) + Number(b.free) + Number(b.locked);
  }
  return out;
}

interface RawTrade {
  id: number;
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
}

export async function fetchBuyTrades(base: string, quote: string): Promise<Trade[]> {
  const pair = base + quote;
  const all: RawTrade[] = [];
  let fromId: number | undefined;
  for (let page = 0; page < 5; page++) {
    const rows = await signedGet<RawTrade[]>("/api/v3/myTrades", {
      symbol: pair,
      limit: 1000,
      ...(fromId !== undefined ? { fromId } : {}),
    });
    all.push(...rows);
    if (rows.length < 1000) break;
    fromId = rows[rows.length - 1].id + 1;
  }
  return all
    .filter((t) => t.isBuyer)
    .map((t) => {
      const price = Number(t.price);
      const commission = Number(t.commission);
      const fee = t.commissionAsset === base ? commission * price : t.commissionAsset === quote ? commission : 0;
      return { id: `bn-${pair}-${t.id}`, symbol: base, time: t.time, price, qty: Number(t.qty), fee, source: "binance" as const };
    });
}

export const accountEnabled = () => true;
