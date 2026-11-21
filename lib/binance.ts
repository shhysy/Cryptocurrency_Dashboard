import type { Candle, Trade } from "@/strategy/types";
import { isSpotOrderSubmissionEnabled, resolveServerBinanceEnvironment } from "./binance-environment";
import { isTraderOrderSubmissionAuthorized } from "./execution/server/auto-trade-mode";
import { calculateLimitNotional, calculateLimitOrderPrice, floorQuantityToStep, quoteBudgetToBaseQuantity } from "./execution/server/limit-order";

const AUTO_TRADE_SPOT_ENVIRONMENT = process.env.AUTO_TRADE_MODE === "testnet" || process.env.AUTO_TRADE_MODE === "production"
  ? process.env.AUTO_TRADE_MODE
  : process.env.BINANCE_SPOT_ENVIRONMENT;
const SPOT_ENV = resolveServerBinanceEnvironment({
  BINANCE_SPOT_ENVIRONMENT: AUTO_TRADE_SPOT_ENVIRONMENT,
  BINANCE_TESTNET_API_KEY: process.env.BINANCE_TESTNET_API_KEY,
  BINANCE_TESTNET_API_SECRET: process.env.BINANCE_TESTNET_API_SECRET,
  BINANCE_API_KEY: process.env.BINANCE_API_KEY,
  BINANCE_API_SECRET: process.env.BINANCE_API_SECRET,
  BINANCE_BASE_URL: process.env.BINANCE_BASE_URL,
});
const SPOT_TESTNET = SPOT_ENV.mode === "testnet";

/** 返回服务端当前 Spot 环境，仅供同源路由校验客户端构建环境是否一致。 */
export function getServerBinanceSpotMode(): "testnet" | "production" {
  return SPOT_ENV.mode;
}
const SPOT_BASE = SPOT_ENV.apiBase;
const apiKey = () => SPOT_ENV.apiKey;
const apiSecret = () => SPOT_ENV.apiSecret;

/**
 * 币安接口封装。
 * - 公开行情：不需要密钥。
 * - 账户 / 成交：HMAC SHA256 签名，密钥只在服务端读取（process.env），不会进入前端包。
 * - 浏览器只读接口与服务端签名订单提交分离；提现请求不在此模块实现。
 */
// 公开行情优先走只读行情域名 data-api.binance.vision（无需 Key，对云厂商 IP 更宽松），失败再回退
const PUBLIC_BASES = SPOT_TESTNET
  ? [SPOT_BASE]
  : ["https://data-api.binance.vision", "https://api.binance.com"];

/** 账户余额 / 成交默认开启（需要主域名 + 签名）。设置 ENABLE_ACCOUNT=0 可关闭（如部署到受限的云环境）。 */
export const accountEnabled = () => process.env.ENABLE_ACCOUNT !== "0";

const SIGNED_BASE = SPOT_BASE;

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

export interface Ticker {
  price: number;
  change24h: number; // 小数
}

// ---------- U 本位合约公开行情（原油 CLUSDT 等）----------
// 合约与现货域名不同；只读 klines / ticker，不签名、不下单。
const FAPI_BASES = [
  process.env.BINANCE_FAPI_URL,
  "https://fapi.binance.com",
].filter(Boolean) as string[];

async function futuresGet<T>(path: string): Promise<T> {
  let lastErr: unknown;
  for (const base of FAPI_BASES) {
    try {
      return await getJson<T>(base + path);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** 合约 24h ticker（单个交易对）。 */
export async function fetchFuturesTicker(pair: string): Promise<Ticker> {
  const r = await futuresGet<{ lastPrice: string; priceChangePercent: string }>(
    `/fapi/v1/ticker/24hr?symbol=${pair}`,
  );
  return { price: Number(r.lastPrice), change24h: Number(r.priceChangePercent) / 100 };
}

/** 合约 K 线（周线等）。上市较晚的品种根数可能少于现货。 */
export async function fetchFuturesKlines(pair: string, interval: "1w", limit: number): Promise<Candle[]> {
  const rows = await futuresGet<(string | number)[][]>(
    `/fapi/v1/klines?symbol=${pair}&interval=${interval}&limit=${limit}`,
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


/** 读取当前 Binance 环境的服务器时间，并返回本机往返时延中点用于启动时钟自检。 */
export async function fetchBinanceServerTime(): Promise<{
  serverTime: number;
  localMidpoint: number;
  roundTripMs: number;
}> {
  const startedAt = Date.now();
  const response = await publicGet<{ serverTime: number }>("/api/v3/time");
  const finishedAt = Date.now();
  if (!Number.isSafeInteger(response.serverTime) || response.serverTime <= 0) {
    throw new Error("Binance服务器时间响应无效");
  }
  return {
    serverTime: response.serverTime,
    localMidpoint: (startedAt + finishedAt) / 2,
    roundTripMs: finishedAt - startedAt,
  };
}

// ---------- 公开行情 ----------
export async function fetchTickers(pairs: string[]): Promise<Record<string, Ticker>> {
  const symbols = encodeURIComponent(JSON.stringify(pairs));
  const rows = await publicGet<{ symbol: string; lastPrice: string; priceChangePercent: string }[]>(
    `/api/v3/ticker/24hr?symbols=${symbols}&type=MINI`,
  );
  const out: Record<string, Ticker> = {};
  for (const r of rows) out[r.symbol] = { price: Number(r.lastPrice), change24h: Number(r.priceChangePercent) / 100 };
  return out;
}

export async function fetchKlines(pair: string, interval: "1w", limit: number): Promise<Candle[]> {
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

/**
 * 恐惧贪婪指数（alternative.me，0 = 极度恐惧，100 = 极度贪婪）。
 * 不是币安数据，所以独立于 publicGet；失败时由上层缓存兜底。
 */
export async function fetchFearGreed(): Promise<number> {
  const j = await getJson<{ data: { value: string }[] }>("https://api.alternative.me/fng/?limit=1");
  const v = Number(j.data?.[0]?.value);
  if (!Number.isFinite(v)) throw new Error("Fear&Greed: bad response");
  return v;
}

// ---------- Yahoo Finance（备用） ----------
interface YahooChart {
  chart: {
    result?: {
      meta: { regularMarketPrice: number };
      timestamp?: number[];
      indicators: { quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[] };
    }[];
  };
}
const YAHOO_HEADERS = { "User-Agent": "Mozilla/5.0" };
const yahooUrl = (sym: string, interval: string, range: string) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`;

/** 周线 K 线（约 10 年）。Yahoo 偶尔返回 null 的未完成行，直接丢掉。 */
export async function fetchYahooWeekly(sym: string): Promise<Candle[]> {
  const j = await getJson<YahooChart>(yahooUrl(sym, "1wk", "10y"), YAHOO_HEADERS);
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

/** 现价和相对上一交易日收盘的涨跌幅。 */
export async function fetchYahooQuote(sym: string): Promise<Ticker> {
  const j = await getJson<YahooChart>(yahooUrl(sym, "1d", "5d"), YAHOO_HEADERS);
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

/**
 * 合并币安「活期理财」凭证：LD 开头的资产（LDUNI = 理财里的 UNI）按原币种累加，
 * 现货和理财里的同一个币合成一笔。随时可赎回，所以按资产计入。
 */
/** Keep Spot-account assets under their exact exchange asset code.
 * Simple Earn holdings are read from the dedicated Simple Earn position API;
 * LD-prefixed tickers must not be guessed back into their base asset.
 */
export function mergeEarnBalances(balances: { asset: string; free: string; locked: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const balance of balances) {
    const qty = Number(balance.free) + Number(balance.locked);
    if (!Number.isFinite(qty) || qty < 0) throw new Error("Binance 现货资产余额无效");
    out[balance.asset] = (out[balance.asset] ?? 0) + qty;
  }
  return out;
}
interface RawTrade {
  id: number;
  orderId: number;
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
      const rawQty = Number(t.qty);
      const netQty = t.commissionAsset === base ? rawQty - commission : rawQty;
      if (!Number.isFinite(netQty) || netQty <= 0) throw new Error("Binance 买入手续费超过成交数量");
      return { id: `bn-${pair}-${t.id}`, orderId: String(t.orderId), symbol: base, time: t.time, price, qty: netQty, fee, source: "binance" as const };
    });
}


const SIGNED_READ_PARAMS: Record<string, ReadonlySet<string>> = {
  "/api/v3/account": new Set(["omitZeroBalances"]),
  "/api/v3/myTrades": new Set(["symbol", "orderId", "limit", "fromId"]),
  "/api/v3/order": new Set(["symbol", "orderId", "origClientOrderId"]),
  "/api/v3/exchangeInfo": new Set(["symbol", "symbols"]),
  "/sapi/v1/simple-earn/flexible/position": new Set(["asset", "current", "size"]),
  "/sapi/v1/simple-earn/locked/position": new Set(["asset", "current", "size"]),
  "/sapi/v1/simple-earn/flexible/history/redemptionRecord": new Set([
    "asset", "startTime", "endTime", "current", "size", "redeemId", "productId",
  ]),
};

/** Narrow server-side allowlist for browser-originated read-only signed requests. */
export async function fetchSignedBinanceRead<T>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const allowed = SIGNED_READ_PARAMS[path];
  if (!allowed) throw new Error("Binance signed-read endpoint is not allowlisted");
  if (SPOT_TESTNET && path.startsWith("/sapi/")) {
    throw new Error("Binance Spot Testnet does not support Simple Earn SAPI");
  }
  for (const [key, value] of Object.entries(params)) {
    if (!allowed.has(key) || !["string", "number"].includes(typeof value)) {
      throw new Error("Binance signed-read parameter is not allowlisted");
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("Binance signed-read numeric parameter is invalid");
    }
    if (typeof value === "string" && value.length > 128) {
      throw new Error("Binance signed-read parameter is too long");
    }
  }
  return signedGet<T>(path, params);
}


export interface SpotMarketOrderInput {
  side: "BUY" | "SELL";
  symbol: string;
  amount: string;
  clientOrderId: string;
}

export interface SpotMarketOrderResponse {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  status: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED";
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  transactTime: number;
}

interface SpotExchangeFilter {
  filterType: string;
  minQty?: string;
  minPrice?: string;
  maxPrice?: string;
  tickSize?: string;
  maxQty?: string;
  stepSize?: string;
  minNotional?: string;
  maxNotional?: string;
  applyToMarket?: boolean;
  applyMinToMarket?: boolean;
  applyMaxToMarket?: boolean;
}

function scaledDecimal(value: string, decimals: number): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error("币安交易规则返回无效数字");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error("订单精度超过币安交易规则");
  return BigInt(whole) * (10n ** BigInt(decimals)) +
    BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/** 服务端重新核验交易对、市场订单过滤器与交易所可用余额，不信任浏览器预检结果。 */
async function assertSpotMarketOrderPreflight(input: SpotMarketOrderInput): Promise<void> {
  if (!accountEnabled()) throw new Error("ENABLE_ACCOUNT 未开启，禁止自动交易");
  const info = await publicGet<{ symbols?: {
    symbol: string;
    status: string;
    baseAsset: string;
    quoteAsset: string;
    quoteOrderQtyMarketAllowed?: boolean;
    filters: SpotExchangeFilter[];
  }[] }>(`/api/v3/exchangeInfo?symbol=${encodeURIComponent(input.symbol)}`);
  const symbol = info.symbols?.find((item) => item.symbol === input.symbol);
  if (!symbol || symbol.status !== "TRADING" || symbol.quoteAsset !== "USDT") {
    throw new Error("交易对不存在、未开放交易或不是 USDT 报价；已阻止下单");
  }

  const ticker = await fetchTickers([input.symbol]);
  const price = ticker[input.symbol]?.price;
  if (!Number.isFinite(price) || (price ?? 0) <= 0) throw new Error("无法取得有效现货价格，已阻止下单");

  const account = await signedGet<{ balances: { asset: string; free: string; locked: string }[] }>(
    "/api/v3/account",
    { omitZeroBalances: "true" },
  );
  const requiredAsset = input.side === "BUY" ? symbol.quoteAsset : symbol.baseAsset;
  const balance = account.balances.find((item) => item.asset === requiredAsset);
  const free = Number(balance?.free ?? "0");
  if (!Number.isFinite(free) || free < 0) throw new Error("币安可用余额无效，已阻止下单");

  const amount = Number(input.amount);
  const notional = input.side === "BUY" ? amount : amount * price!;
  if (amount > free) throw new Error(`${requiredAsset} 可用余额不足，已阻止下单`);

  const filters = symbol.filters ?? [];
  const marketLot = filters.find((item) => item.filterType === "MARKET_LOT_SIZE") ??
    filters.find((item) => item.filterType === "LOT_SIZE");
  if (input.side === "BUY") {
    if (symbol.quoteOrderQtyMarketAllowed === false) {
      throw new Error("该交易对不允许 quoteOrderQty 市价买入");
    }
  } else {
    if (!marketLot?.stepSize) throw new Error("币安未返回有效 MARKET_LOT_SIZE 规则");
    const decimals = Math.min(12, (marketLot.stepSize.split(".")[1] ?? "").length);
    const qtyUnits = scaledDecimal(input.amount, decimals);
    const stepUnits = scaledDecimal(marketLot.stepSize, decimals);
    if (stepUnits <= 0n || qtyUnits % stepUnits !== 0n) {
      throw new Error("卖出数量不符合币安 MARKET_LOT_SIZE 步长");
    }
    const minQty = Number(marketLot.minQty ?? "0");
    const maxQty = Number(marketLot.maxQty ?? "0");
    if (amount < minQty || (maxQty > 0 && amount > maxQty)) {
      throw new Error("卖出数量超出币安 MARKET_LOT_SIZE 范围");
    }
  }

  const notionalFilter = filters.find((item) => item.filterType === "NOTIONAL") ??
    filters.find((item) => item.filterType === "MIN_NOTIONAL");
  if (notionalFilter) {
    const appliesMin = notionalFilter.filterType === "NOTIONAL"
      ? notionalFilter.applyMinToMarket !== false
      : notionalFilter.applyToMarket !== false;
    const appliesMax = notionalFilter.filterType === "NOTIONAL" &&
      notionalFilter.applyMaxToMarket === true;
    const minNotional = Number(notionalFilter.minNotional ?? "0");
    const maxNotional = Number(notionalFilter.maxNotional ?? "0");
    if (appliesMin && minNotional > 0 && notional + 1e-8 < minNotional) {
      throw new Error("订单名义金额低于币安最小市价单金额");
    }
    if (appliesMax && maxNotional > 0 && notional - 1e-8 > maxNotional) {
      throw new Error("订单名义金额超过币安最大市价单金额");
    }
  }
}

/**
 * 统一 Spot MARKET 下单适配器。
 * 环境、凭证和交易域名完全由服务端 BINANCE_SPOT_ENVIRONMENT 决定；
 * 浏览器参数和 NEXT_PUBLIC 开关不能越过服务端独立授权。
 */
export async function submitSpotMarketOrder(
  input: SpotMarketOrderInput,
): Promise<SpotMarketOrderResponse> {
  return submitSpotMarketOrderInternal(input, false);
}

/** 本地Trader专用入口。为兼容既有调用方保留旧名称，但自动交易只提交LIMIT GTC。 */
export async function submitTraderSpotMarketOrder(
  input: SpotMarketOrderInput,
): Promise<SpotMarketOrderResponse> {
  return submitTraderSpotLimitOrder(input);
}

/** 自动Trader唯一订单入口：BUY/SELL均使用LIMIT GTC，不会提交MARKET订单。 */
export async function submitTraderSpotLimitOrder(
  input: SpotMarketOrderInput,
): Promise<SpotMarketOrderResponse> {
  const mode = SPOT_ENV.mode;
  if (!isTraderOrderSubmissionAuthorized(mode, process.env)) {
    throw new Error("AUTO_TRADE_MODE未授权当前订单，已阻止提交");
  }
  if (!apiKey() || !apiSecret()) {
    throw new Error(mode === "testnet" ? "服务端缺少 Binance Testnet API Key/Secret" : "服务端缺少 Binance Production API Key/Secret");
  }
  if (!/^[A-Z0-9]{5,24}$/.test(input.symbol)) throw new Error("交易对格式无效");
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(input.amount) || Number(input.amount) <= 0) {
    throw new Error("订单数量或金额无效");
  }
  if (!/^[A-Za-z0-9_-]{1,36}$/.test(input.clientOrderId)) throw new Error("clientOrderId格式无效");
  if (!accountEnabled()) throw new Error("ENABLE_ACCOUNT未开启，禁止自动交易");

  const info = await publicGet<{ symbols?: {
    symbol: string; status: string; baseAsset: string; quoteAsset: string; filters: SpotExchangeFilter[];
  }[] }>(`/api/v3/exchangeInfo?symbol=${encodeURIComponent(input.symbol)}`);
  const symbol = info.symbols?.find((item) => item.symbol === input.symbol);
  if (!symbol || symbol.status !== "TRADING" || symbol.quoteAsset !== "USDT") {
    throw new Error("交易对不存在、未开放交易或不是USDT报价；已阻止下单");
  }
  const priceFilter = symbol.filters.find((item) => item.filterType === "PRICE_FILTER");
  const lotFilter = symbol.filters.find((item) => item.filterType === "LOT_SIZE");
  if (!priceFilter?.tickSize || !lotFilter?.stepSize) {
    throw new Error("Binance缺少PRICE_FILTER或LOT_SIZE规则，已阻止下单");
  }
  const ticker = await publicGet<{ symbol: string; price: string }>(`/api/v3/ticker/price?symbol=${encodeURIComponent(input.symbol)}`);
  if (ticker.symbol !== input.symbol || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(ticker.price) || Number(ticker.price) <= 0) {
    throw new Error("无法取得有效现货参考价格，已阻止下单");
  }
  const referencePriceText = ticker.price;
  const price = calculateLimitOrderPrice({
    side: input.side, referencePrice: referencePriceText, tickSize: priceFilter.tickSize,
  });
  const account = await signedGet<{ balances: { asset: string; free: string; locked: string }[] }>(
    "/api/v3/account", { omitZeroBalances: "true" },
  );
  const quoteBalance = account.balances.find((item) => item.asset === symbol.quoteAsset);
  const baseBalance = account.balances.find((item) => item.asset === symbol.baseAsset);
  let quantity: string;
  if (input.side === "BUY") {
    const freeQuote = quoteBalance?.free ?? "0";
    if (Number(input.amount) > Number(freeQuote)) throw new Error("USDT可用余额不足，已阻止BUY订单");
    quantity = quoteBudgetToBaseQuantity(input.amount, price, lotFilter.stepSize);
  } else {
    const freeBase = baseBalance?.free ?? "0";
    if (Number(input.amount) > Number(freeBase)) throw new Error(`${symbol.baseAsset}可用余额不足，已阻止SELL订单`);
    quantity = floorQuantityToStep(input.amount, lotFilter.stepSize);
    if (quantity !== input.amount) throw new Error("SELL数量不符合LOT_SIZE步长，已阻止下单");
  }
  if (Number(quantity) <= 0) throw new Error("按LOT_SIZE取整后订单数量为0，已阻止下单");
  const minQty = Number(lotFilter.minQty ?? "0");
  const maxQty = Number(lotFilter.maxQty ?? "0");
  if (Number(quantity) < minQty || (maxQty > 0 && Number(quantity) > maxQty)) {
    throw new Error("订单数量超出Binance LOT_SIZE范围");
  }
  const notional = calculateLimitNotional(price, quantity);
  const notionalFilter = symbol.filters.find((item) => item.filterType === "NOTIONAL")
    ?? symbol.filters.find((item) => item.filterType === "MIN_NOTIONAL");
  if (notionalFilter) {
    const minNotional = Number(notionalFilter.minNotional ?? "0");
    const maxNotional = Number(notionalFilter.maxNotional ?? "0");
    if (minNotional > 0 && Number(notional) < minNotional) {
      throw new Error("LIMIT订单名义金额低于Binance最小要求");
    }
    if (maxNotional > 0 && Number(notional) > maxNotional) {
      throw new Error("LIMIT订单名义金额超过Binance最大要求");
    }
  }
  const minPrice = Number(priceFilter.minPrice ?? "0");
  const maxPrice = Number(priceFilter.maxPrice ?? "0");
  if (Number(price) < minPrice || (maxPrice > 0 && Number(price) > maxPrice)) {
    throw new Error("限价超出Binance PRICE_FILTER范围");
  }

  const params: Record<string, string | number> = {
    symbol: input.symbol,
    side: input.side,
    type: "LIMIT",
    timeInForce: "GTC",
    quantity,
    price,
    newClientOrderId: input.clientOrderId,
    newOrderRespType: "FULL",
    recvWindow: 10000,
    timestamp: Math.round(await serverNow()),
  };
  const qs = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
  const signature = await hmacHex(apiSecret(), qs);
  const response = await doFetch(SIGNED_BASE + "/api/v3/order?" + qs + "&signature=" + signature, {
    method: "POST",
    headers: { "X-MBX-APIKEY": apiKey() },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Binance ${mode} LIMIT order ${response.status}: ${body.slice(0, 240)}`);
  }
  let parsed: SpotMarketOrderResponse;
  try { parsed = JSON.parse(body) as SpotMarketOrderResponse; }
  catch { throw new Error("Binance LIMIT响应无法解析；必须按原clientOrderId只读对账，禁止重发"); }
  if (parsed.symbol !== input.symbol || parsed.clientOrderId !== input.clientOrderId ||
      !Number.isSafeInteger(parsed.orderId) || parsed.orderId <= 0 ||
      !["NEW", "PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED", "EXPIRED"].includes(parsed.status)) {
    throw new Error("Binance LIMIT响应字段不匹配；必须按原clientOrderId只读对账，禁止重发");
  }
  return parsed;
}

async function submitSpotMarketOrderInternal(
  input: SpotMarketOrderInput,
  allowTraderMode: boolean,
): Promise<SpotMarketOrderResponse> {
  const mode = SPOT_ENV.mode;
  const modeDerivedEnabled = allowTraderMode && isTraderOrderSubmissionAuthorized(mode, process.env);
  const enabled = modeDerivedEnabled || isSpotOrderSubmissionEnabled(mode, input.side, {
    BINANCE_TESTNET_BUY_ENABLED: process.env.BINANCE_TESTNET_BUY_ENABLED,
    BINANCE_TESTNET_SELL_ENABLED: process.env.BINANCE_TESTNET_SELL_ENABLED,
    BINANCE_PRODUCTION_BUY_ENABLED: process.env.BINANCE_PRODUCTION_BUY_ENABLED,
    BINANCE_PRODUCTION_SELL_ENABLED: process.env.BINANCE_PRODUCTION_SELL_ENABLED,
  });
  if (!enabled) throw new Error(`${mode === "testnet" ? "测试网" : "生产环境"}${input.side} 订单服务端开关未启用（开关未在服务端启用）`);
  if (!apiKey() || !apiSecret()) {
    throw new Error(mode === "testnet" ? "服务端缺少 Binance Testnet API Key/Secret" : "服务端缺少 Binance Production API Key/Secret");
  }
  if (!/^[A-Z0-9]{5,24}$/.test(input.symbol)) throw new Error("交易对格式无效");
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(input.amount) || Number(input.amount) <= 0) {
    throw new Error("订单数量或金额无效");
  }
  if (!/^[A-Za-z0-9_-]{1,36}$/.test(input.clientOrderId)) throw new Error("clientOrderId 格式无效");

  await assertSpotMarketOrderPreflight(input);
  const serverTime = await serverNow();
  const params: Record<string, string | number> = {
    symbol: input.symbol,
    side: input.side,
    type: "MARKET",
    ...(input.side === "BUY" ? { quoteOrderQty: input.amount } : { quantity: input.amount }),
    newClientOrderId: input.clientOrderId,
    newOrderRespType: "FULL",
    recvWindow: 10000,
    timestamp: Math.round(serverTime),
  };
  const qs = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  ).toString();
  const signature = await hmacHex(apiSecret(), qs);
  const response = await doFetch(SIGNED_BASE + "/api/v3/order?" + qs + "&signature=" + signature, {
    method: "POST",
    headers: { "X-MBX-APIKEY": apiKey() },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Binance ${mode} order ${response.status}: ${body.slice(0, 240)}`);
  }
  let parsed: SpotMarketOrderResponse;
  try {
    parsed = JSON.parse(body) as SpotMarketOrderResponse;
  } catch {
    throw new Error("Binance 响应无法解析；必须按 clientOrderId 对账，禁止重发");
  }
  if (parsed.symbol !== input.symbol || parsed.clientOrderId !== input.clientOrderId ||
      !Number.isSafeInteger(parsed.orderId) || parsed.orderId <= 0 ||
      !["NEW", "PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED", "EXPIRED"].includes(parsed.status)) {
    throw new Error("Binance 响应字段不匹配；必须按 clientOrderId 对账，禁止重发");
  }
  return parsed;
}

/** 兼容旧测试网路由；它永远拒绝生产环境。 */
export async function submitTestnetSpotMarketOrder(
  input: SpotMarketOrderInput,
): Promise<SpotMarketOrderResponse> {
  if (!SPOT_TESTNET) throw new Error("旧测试网订单接口仅允许 Binance Spot Testnet");
  return submitSpotMarketOrder(input);
}
