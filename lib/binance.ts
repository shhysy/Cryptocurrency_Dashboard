import type { Candle, Trade } from "@/strategy/types";
import { FALLBACK_BINANCE_API_KEY, FALLBACK_BINANCE_API_SECRET } from "./credentials";

const apiKey = () => process.env.BINANCE_API_KEY || FALLBACK_BINANCE_API_KEY;
const apiSecret = () => process.env.BINANCE_API_SECRET || FALLBACK_BINANCE_API_SECRET;

/**
 * 币安接口封装。
 * - 公开行情：不需要密钥。
 * - 账户 / 成交：HMAC SHA256 签名，密钥只在服务端读取（process.env），不会进入前端包。
 * - 只调用 GET 只读接口，代码里没有任何下单 / 提现请求。
 */
const PUBLIC_BASES = [
  process.env.BINANCE_BASE_URL,
  "https://api.binance.com",
  "https://data-api.binance.vision",
].filter(Boolean) as string[];

const SIGNED_BASE = process.env.BINANCE_BASE_URL || "https://api.binance.com";

/**
 * 代理：设置 PROXY_URL（如 http://127.0.0.1:7897）后，所有币安请求经该代理发出。
 * Node 内置 fetch 不读系统代理，且与外部 undici 的 dispatcher 版本不兼容，
 * 所以走代理时改用 undici 自带的 fetch。仅 Node 运行时可用；Cloudflare Workers 留空即可。
 */
async function doFetch(url: string, init: RequestInit): Promise<Response> {
  const proxy = process.env.PROXY_URL;
  if (!proxy) return fetch(url, init);
  const undici = await import("undici");
  const g = globalThis as { __proxyAgent?: InstanceType<typeof undici.ProxyAgent> };
  g.__proxyAgent ??= new undici.ProxyAgent(proxy);
  return (await undici.fetch(url, { ...(init as object), dispatcher: g.__proxyAgent } as never)) as unknown as Response;
}

async function getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const res = await doFetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Binance ${res.status}: ${body.slice(0, 160)}`);
  }
  return res.json() as Promise<T>;
}

async function publicGet<T>(path: string): Promise<T> {
  let lastErr: unknown;
  for (const base of PUBLIC_BASES) {
    try {
      return await getJson<T>(base + path);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export function hasCredentials() {
  return Boolean(apiKey() && apiSecret());
}

async function hmacHex(secret: string, message: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 本机时钟与币安服务器的偏差（ms）。时钟不准会导致 -1021 错误，所以签名前先校时。
let clockOffset: number | null = null;
let clockSyncedAt = 0;
async function serverNow(): Promise<number> {
  if (clockOffset === null || Date.now() - clockSyncedAt > 30 * 60_000) {
    const t0 = Date.now();
    const { serverTime } = await publicGet<{ serverTime: number }>("/api/v3/time");
    const t1 = Date.now();
    clockOffset = serverTime - (t0 + t1) / 2;
    clockSyncedAt = t1;
  }
  return Date.now() + clockOffset;
}

async function signedGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const key = apiKey();
  const secret = apiSecret();
  const qs = new URLSearchParams(
    Object.entries({ ...params, recvWindow: 10000, timestamp: Math.round(await serverNow()) }).map(([k, v]) => [k, String(v)]),
  ).toString();
  const signature = await hmacHex(secret, qs);
  return getJson<T>(`${SIGNED_BASE}${path}?${qs}&signature=${signature}`, { "X-MBX-APIKEY": key });
}

// ---------- 公开行情 ----------
export interface Ticker {
  price: number;
  change24h: number; // 小数
}

export async function fetchTickers(pairs: string[]): Promise<Record<string, Ticker>> {
  const symbols = encodeURIComponent(JSON.stringify(pairs));
  const rows = await publicGet<{ symbol: string; lastPrice: string; priceChangePercent: string }[]>(
    `/api/v3/ticker/24hr?symbols=${symbols}&type=MINI`,
  );
  const out: Record<string, Ticker> = {};
  for (const r of rows) out[r.symbol] = { price: Number(r.lastPrice), change24h: Number(r.priceChangePercent) / 100 };
  return out;
}

export async function fetchKlines(pair: string, interval: "1w" | "1M", limit: number): Promise<Candle[]> {
  const rows = await publicGet<(string | number)[][]>(
    `/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`,
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

// ---------- 账户（只读） ----------
export async function fetchBalances(): Promise<Record<string, number>> {
  const acc = await signedGet<{ balances: { asset: string; free: string; locked: string }[] }>("/api/v3/account", {
    omitZeroBalances: "true",
  });
  return mergeEarnBalances(acc.balances);
}

/**
 * 合并币安「活期理财」凭证：LD 开头的资产（LDUNI = 理财里的 UNI）按原币种累加，
 * 现货和理财里的同一个币合成一笔。随时可赎回，所以按资产计入。
 */
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

/** 读取某交易对的买入成交（myTrades，每页 1000，最多翻 5 页）。 */
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
      // 手续费折算为 USDT：以买到的币扣费 -> 乘成交价；以 USDT 扣费 -> 原值；BNB 等其他币 -> 记 0
      const fee = t.commissionAsset === base ? commission * price : t.commissionAsset === quote ? commission : 0;
      return { id: `bn-${pair}-${t.id}`, symbol: base, time: t.time, price, qty: Number(t.qty), fee, source: "binance" as const };
    });
}
