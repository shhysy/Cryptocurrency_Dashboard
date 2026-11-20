import { normalizeFlexibleEarnPosition, sumSimpleEarnUsdtPositions, type SimpleEarnPositionPage, type UsdtWalletBuckets } from "./execution/wallet-funds";
/**
 * Browser-facing Binance adapter.
 * Public market data may be fetched directly; signed reads are routed through
 * the same-origin server proxy. No API credential is included in this module.
 */
import type { Candle, Trade } from "@/strategy/types";
import { assertSimpleEarnSupported } from "./binance-environment";

// 浏览器端只保留公开 Spot endpoint 选择，不再读取或签署任何 API 凭证。
// 所有需要 Key/Secret 的账户、成交和交易请求必须迁移到服务端代理。
export const BINANCE_SPOT_ENVIRONMENT =
  process.env.NEXT_PUBLIC_BINANCE_SPOT_TESTNET === "1" ? "testnet" : "production";
export const BINANCE_SPOT_API_BASE =
  BINANCE_SPOT_ENVIRONMENT === "testnet"
    ? "https://testnet.binance.vision"
    : "https://api.binance.com";
const API_KEY = "";
const API_SECRET = "";
const BASE = BINANCE_SPOT_API_BASE;
export const BINANCE_SPOT_BUY_SUBMISSION_ENABLED =
  BINANCE_SPOT_ENVIRONMENT === "testnet"
    ? process.env.NEXT_PUBLIC_BINANCE_TESTNET_BUY_ENABLED === "1"
    : process.env.NEXT_PUBLIC_BINANCE_PRODUCTION_BUY_ENABLED === "1";
export const BINANCE_SPOT_SELL_SUBMISSION_ENABLED =
  BINANCE_SPOT_ENVIRONMENT === "testnet"
    ? process.env.NEXT_PUBLIC_BINANCE_TESTNET_SELL_ENABLED === "1"
    : process.env.NEXT_PUBLIC_BINANCE_PRODUCTION_SELL_ENABLED === "1";

function assertSimpleEarnProductionOnly(): void {
  assertSimpleEarnSupported(BINANCE_SPOT_ENVIRONMENT);
}

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
  const response = await fetch("/api/binance/signed-read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, params }),
    cache: "no-store",
    credentials: "same-origin",
  });
  const body = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("服务端 Binance 只读代理返回了无效响应");
  }
  if (!response.ok) {
    const detail = parsed && typeof parsed === "object" && "detail" in parsed
      ? String((parsed as { detail: unknown }).detail)
      : "Binance 只读请求失败";
    throw new Error(detail.slice(0, 180));
  }
  return parsed as T;
}

/**
 * Real Earn redemption remains deliberately disabled until the user has
 * confirmed the TRADE-enabled key and explicitly enables this feature.
 * The key/secret are still supplied through the existing private-use browser
 * configuration; never commit credential values to the repository.
 */
export const LIVE_EARN_REDEMPTION_ENABLED = false as const;

export const LIVE_SPOT_ORDER_SUBMISSION_ENABLED = false as const;

export interface BinanceSpotOrderSubmitResponse {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  status: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED";
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  transactTime: number;
}

export const LIVE_SPOT_SELL_SUBMISSION_ENABLED = false as const;

async function postSpotMarketOrder(input: {
  side: "BUY" | "SELL";
  symbol: string;
  amount: string;
  clientOrderId: string;
}): Promise<BinanceSpotOrderSubmitResponse> {
  const response = await fetch("/api/binance/spot-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify(input),
  });
  const raw = await response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    throw new Error("订单代理响应无法解析；必须按 clientOrderId 对账，禁止重发");
  }
  if (!response.ok) {
    const detail = parsed && typeof parsed === "object" && "detail" in parsed
      ? String((parsed as { detail: unknown }).detail)
      : "订单提交失败";
    throw new Error(detail.slice(0, 220));
  }
  const order = parsed as BinanceSpotOrderSubmitResponse;
  if (order.symbol !== input.symbol || order.clientOrderId !== input.clientOrderId ||
      !Number.isSafeInteger(order.orderId) || order.orderId <= 0 ||
      !["NEW", "PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED", "EXPIRED"].includes(order.status)) {
    throw new Error("订单响应不匹配；必须按 clientOrderId 对账，禁止重发");
  }
  return order;
}

export async function submitSpotMarketSell(input: {
  symbol: string; quantity: string; clientOrderId: string;
}): Promise<BinanceSpotOrderSubmitResponse> {
  if (!BINANCE_SPOT_SELL_SUBMISSION_ENABLED) throw new Error("当前环境卖出开关未启用；不会发送订单 POST");
  if (!/^[A-Z0-9]{5,24}$/.test(input.symbol) ||
      !/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(input.quantity) ||
      Number(input.quantity) <= 0 || !/^[A-Za-z0-9_-]{1,36}$/.test(input.clientOrderId)) {
    throw new Error("现货市价卖单参数无效");
  }
  return postSpotMarketOrder({ side: "SELL", symbol: input.symbol, amount: input.quantity, clientOrderId: input.clientOrderId });
}

export async function submitSpotMarketBuy(input: {
  symbol: string; quoteOrderQty: string; clientOrderId: string;
}): Promise<BinanceSpotOrderSubmitResponse> {
  if (!BINANCE_SPOT_BUY_SUBMISSION_ENABLED) throw new Error("当前环境买入开关未启用；不会发送订单 POST");
  if (!/^[A-Z0-9]{5,24}$/.test(input.symbol) ||
      !/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(input.quoteOrderQty) ||
      Number(input.quoteOrderQty) <= 0 || !/^[A-Za-z0-9_-]{1,36}$/.test(input.clientOrderId)) {
    throw new Error("现货市价买单参数无效");
  }
  return postTestnetMarketOrder({ side: "BUY", symbol: input.symbol, amount: input.quoteOrderQty, clientOrderId: input.clientOrderId });
}

export interface FlexibleEarnRedemptionSubmitResponse {
  redeemId: number | string;
  success?: boolean;
}

export async function redeemFlexibleEarnUsdt(input: {
  productId: string;
  amountUsdt: number;
}): Promise<FlexibleEarnRedemptionSubmitResponse> {
  assertSimpleEarnProductionOnly();
  if (!LIVE_EARN_REDEMPTION_ENABLED) {
    throw new Error("真实理财赎回尚未启用；当前不会发送 Binance POST 请求");
  }
  if (!API_KEY || !API_SECRET) throw new Error("缺少 Binance API Key/Secret");
  if (!input.productId.trim() || !Number.isFinite(input.amountUsdt) || input.amountUsdt <= 0) {
    throw new Error("理财赎回产品或金额无效");
  }
  const params = {
    productId: input.productId,
    amount: input.amountUsdt.toFixed(8).replace(/\.?0+$/, ""),
    destAccount: "SPOT",
    recvWindow: 10000,
    timestamp: Math.round(await serverNow()),
  };
  const qs = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  ).toString();
  const signature = await hmacHex(API_SECRET, qs);
  const res = await fetch(`${BASE}/sapi/v1/simple-earn/flexible/redeem?${qs}&signature=${signature}`, {
    method: "POST",
    headers: { "X-MBX-APIKEY": API_KEY },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`Binance Flexible redeem ${res.status}: ${body.slice(0, 300)}`);
  let parsed: FlexibleEarnRedemptionSubmitResponse;
  try {
    parsed = JSON.parse(body) as FlexibleEarnRedemptionSubmitResponse;
  } catch {
    throw new Error("Binance 赎回响应无法解析；必须通过历史记录人工核对，禁止重发");
  }
  if (parsed.redeemId === undefined || parsed.redeemId === null || String(parsed.redeemId).trim() === "") {
    throw new Error("Binance 赎回响应缺少 redeemId；必须通过历史记录人工核对，禁止重发");
  }
  return parsed;
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

// ---------- 交易执行前置读取（仍然只读，不发送订单） ----------
export interface SpotSymbolFilters {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  basePrecision: number;
  quotePrecision: number;
  quoteOrderQtyMarketAllowed?: boolean;
  filters: Record<string, string | number | boolean>[];
}

export interface SpotAssetBalance {
  asset: string;
  free: number;
  locked: number;
  total: number;
}

/** Read-only exact free/locked balance for one spot asset. */
export async function fetchSpotAssetBalance(asset: string): Promise<SpotAssetBalance> {
  if (!/^[A-Z0-9]{2,20}$/.test(asset)) throw new Error("查询现货资产代码无效");
  const account = await signedGet<{ balances: { asset: string; free: string; locked: string }[] }>("/api/v3/account");
  const row = account.balances.find((item) => item.asset === asset);
  const free = Number(row?.free ?? 0);
  const locked = Number(row?.locked ?? 0);
  if (![free, locked].every(Number.isFinite) || free < 0 || locked < 0) {
    throw new Error("Binance 返回的现货资产余额无效");
  }
  return { asset, free, locked, total: free + locked };
}

/** Read Spot USDT and Simple Earn USDT Flexible/Locked positions using USER_DATA GETs only.
 * Flexible Earn availability is shown separately; this function never redeems
 * assets and does not claim that the API order endpoint can consume Earn directly.
 */
export async function fetchSpotAndEarnUsdtBalances(): Promise<Pick<UsdtWalletBuckets,
  "spotFreeUsdt" | "spotLockedUsdt" | "flexibleEarnUsdt" |
  "flexibleEarnRedeemingUsdt" | "flexibleEarnFrozenUsdt" | "lockedEarnUsdt" | "lockedEarnRedeemingUsdt">> {
  assertSimpleEarnProductionOnly();
  const account = await signedGet<{ balances: { asset: string; free: string; locked: string }[] }>(
    "/api/v3/account",
  );
  const spot = account.balances.find((row) => row.asset === "USDT");
  const spotFreeUsdt = Number(spot?.free ?? "0");
  const spotLockedUsdt = Number(spot?.locked ?? "0");
  if (![spotFreeUsdt, spotLockedUsdt].every((n) => Number.isFinite(n) && n >= 0)) {
    throw new Error("Binance Spot USDT 余额无效");
  }

  const [flexibleRows, lockedRows] = await Promise.all([
    fetchFlexibleEarnUsdtPositions(),
    fetchLockedEarnUsdtPositions(),
  ]);
  const flexible = sumSimpleEarnUsdtPositions(flexibleRows);
  const locked = sumSimpleEarnUsdtPositions(lockedRows);
  return {
    spotFreeUsdt,
    spotLockedUsdt,
    flexibleEarnUsdt: flexible.totalUsdt,
    // Flexible position API does not expose a per-position redeeming amount.
    // Pending redemptions are tracked by the local intent ledger and history API.
    flexibleEarnRedeemingUsdt: 0,
    flexibleEarnFrozenUsdt: flexible.frozenUsdt,
    lockedEarnUsdt: locked.totalUsdt,
    lockedEarnRedeemingUsdt: locked.redeemingUsdt,
  };
}

export interface FlexibleEarnRedemptionRecord {
  amount?: string;
  asset?: string;
  time?: number;
  projectId?: string;
  productId?: string;
  redeemId?: number | string;
  destAccount?: string;
  status?: string;
}

interface FlexibleEarnApiPosition {
  asset: string;
  productId?: string;
  totalAmount: string;
  canRedeem?: boolean;
  collateralAmount?: string;
}

interface LockedEarnApiPosition {
  asset: string;
  amount: string;
  redeemingAmt?: string;
}

async function fetchLockedEarnUsdtPositions(): Promise<SimpleEarnPositionPage["rows"]> {
  assertSimpleEarnProductionOnly();
  const rows: SimpleEarnPositionPage["rows"] = [];
  for (let current = 1; current <= 20; current++) {
    const page = await signedGet<{ total: number; rows: LockedEarnApiPosition[] }>(
      "/sapi/v1/simple-earn/locked/position",
      { asset: "USDT", current, size: 100 },
    );
    if (!Array.isArray(page.rows)) throw new Error("Binance Simple Earn 定期持仓响应格式无效");
    rows.push(...page.rows.map((row) => ({
      asset: row.asset,
      amount: row.amount,
      redeemingAmt: row.redeemingAmt ?? "0",
      freezeAmount: "0",
    })));
    if (rows.length >= page.total || page.rows.length < 100) break;
    if (current === 20) throw new Error("Binance Simple Earn 定期持仓超过分页安全上限，拒绝使用不完整数据");
  }
  return rows;
}

/** Read Flexible Earn positions using Binance's actual totalAmount/canRedeem/productId fields. */
export async function fetchFlexibleEarnUsdtPositions(): Promise<SimpleEarnPositionPage["rows"]> {
  assertSimpleEarnProductionOnly();
  const rows: SimpleEarnPositionPage["rows"] = [];
  for (let current = 1; current <= 20; current++) {
    const page = await signedGet<{ total: number; rows: FlexibleEarnApiPosition[] }>(
      "/sapi/v1/simple-earn/flexible/position",
      { asset: "USDT", current, size: 100 },
    );
    if (!Array.isArray(page.rows)) throw new Error("Binance Simple Earn 活期持仓响应格式无效");
    rows.push(...page.rows.map(normalizeFlexibleEarnPosition));
    if (rows.length >= page.total || page.rows.length < 100) break;
    if (current === 20) throw new Error("Binance Simple Earn 活期持仓超过分页安全上限，拒绝使用不完整数据");
  }
  return rows;
}

/**
 * Read-only redemption history lookup. A returned record is evidence of a
 * redemption request, not by itself proof that funds have reached Spot.
 */
export async function fetchFlexibleEarnRedemptionRecords(input: {
  redeemId?: string;
  productId?: string;
  startTime: number;
  endTime?: number;
}): Promise<FlexibleEarnRedemptionRecord[]> {
  assertSimpleEarnProductionOnly();
  if (!Number.isFinite(input.startTime) || input.startTime <= 0) {
    throw new Error("理财赎回历史查询起始时间无效");
  }
  if (input.endTime !== undefined &&
      (!Number.isFinite(input.endTime) || input.endTime < input.startTime)) {
    throw new Error("理财赎回历史查询结束时间无效");
  }
  const rows: FlexibleEarnRedemptionRecord[] = [];
  for (let current = 1; current <= 20; current++) {
    const params: Record<string, string | number> = {
      asset: "USDT",
      startTime: input.startTime,
      current,
      size: 100,
    };
    if (input.endTime !== undefined) params.endTime = input.endTime;
    if (input.redeemId) params.redeemId = input.redeemId;
    if (input.productId) params.productId = input.productId;
    const page = await signedGet<{ total: number; rows: FlexibleEarnRedemptionRecord[] }>(
      "/sapi/v1/simple-earn/flexible/history/redemptionRecord",
      params,
    );
    if (!Array.isArray(page.rows)) throw new Error("Binance Simple Earn 赎回历史响应格式无效");
    rows.push(...page.rows);
    if (rows.length >= page.total || page.rows.length < 100) break;
  }
  return rows;
}

/** 只返回现货账户 USDT 的 free 字段；不计 locked，不折算其他资产。 */
export async function fetchFreeUsdtBalance(): Promise<number> {
  const acc = await signedGet<{ balances: { asset: string; free: string; locked: string }[] }>("/api/v3/account");
  const row = acc.balances.find((b) => b.asset === "USDT");
  const free = Number(row?.free ?? 0);
  if (!Number.isFinite(free) || free < 0) throw new Error("Binance 返回的 USDT free 余额无效");
  return free;
}

/** 读取交易对状态和过滤器，为后续下单前校验准备；此函数不下单。 */
export async function fetchSpotSymbolFilters(symbol: string): Promise<SpotSymbolFilters> {
  const data = await getJson<{ symbols: SpotSymbolFilters[] }>(
    `${BASE}/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`,
  );
  const found = data.symbols?.find((row) => row.symbol === symbol);
  if (!found) throw new Error(`Binance 未返回交易对规则：${symbol}`);
  return found;
}

// ---------- 账户（只读） ----------
export async function fetchBalances(): Promise<Record<string, number>> {
  const acc = await signedGet<{ balances: { asset: string; free: string; locked: string }[] }>("/api/v3/account", {
    omitZeroBalances: "true",
  });
  return mergeEarnBalances(acc.balances);
}

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
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
}

export interface BinanceSpotOrderSnapshot {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  status: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED";
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  time: number;
  updateTime: number;
}

/** Read-only order lookup. Use origClientOrderId after a timeout before considering any retry. */
export async function fetchSpotOrderByClientId(symbol: string, origClientOrderId: string): Promise<BinanceSpotOrderSnapshot> {
  if (!symbol || !origClientOrderId) throw new Error("查询订单缺少交易对或客户端订单 ID");
  return signedGet<BinanceSpotOrderSnapshot>("/api/v3/order", { symbol, origClientOrderId });
}

export interface BinanceSpotTrade {
  id: number;
  orderId: number;
  symbol: string;
  price: number;
  qty: number;
  quoteQty: number;
  commission: number;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
}


/** Fetch only the fills belonging to one order, avoiding unrelated account history. */
export async function fetchSpotTradesForOrder(symbol: string, orderId: number): Promise<BinanceSpotTrade[]> {
  if (!symbol || !Number.isSafeInteger(orderId) || orderId <= 0) {
    throw new Error("订单成交查询参数无效");
  }
  const all: BinanceSpotTrade[] = [];
  let fromId: number | undefined;
  for (let page = 0; page < 20; page++) {
    const rows = await signedGet<{
      id: number; orderId: number; price: string; qty: string; quoteQty: string;
      commission: string; commissionAsset: string; time: number; isBuyer: boolean;
    }[]>("/api/v3/myTrades", {
      symbol, orderId, limit: 1000, ...(fromId !== undefined ? { fromId } : {}),
    });
    all.push(...rows.map((t) => ({
      id: t.id, orderId: t.orderId, symbol,
      price: Number(t.price), qty: Number(t.qty), quoteQty: Number(t.quoteQty),
      commission: Number(t.commission), commissionAsset: t.commissionAsset,
      time: t.time, isBuyer: t.isBuyer,
    })));
    if (rows.length < 1000) break;
    fromId = rows[rows.length - 1].id + 1;
  }
  return all;
}

/** Read-only order lookup by Binance exchange order ID (used for SELL reconciliation). */
export async function fetchSpotOrderById(symbol: string, orderId: number): Promise<BinanceSpotOrderSnapshot> {
  if (!symbol || !Number.isSafeInteger(orderId) || orderId <= 0) {
    throw new Error("查询订单缺少有效交易对或 Binance 订单 ID");
  }
  return signedGet<BinanceSpotOrderSnapshot>("/api/v3/order", { symbol, orderId });
}

/** Read-only fill history for both BUY and SELL; fill IDs are unique within a symbol. */
export async function fetchSpotTrades(symbol: string, maxPages = 5): Promise<BinanceSpotTrade[]> {
  if (!symbol || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 20) {
    throw new Error("成交查询参数无效");
  }
  const all: BinanceSpotTrade[] = [];
  let fromId: number | undefined;
  for (let page = 0; page < maxPages; page++) {
    const rows = await signedGet<{
      id: number; orderId: number; price: string; qty: string; quoteQty: string;
      commission: string; commissionAsset: string; time: number; isBuyer: boolean;
    }[]>("/api/v3/myTrades", {
      symbol, limit: 1000, ...(fromId !== undefined ? { fromId } : {}),
    });
    all.push(...rows.map((t) => ({
      id: t.id, orderId: t.orderId, symbol,
      price: Number(t.price), qty: Number(t.qty), quoteQty: Number(t.quoteQty),
      commission: Number(t.commission), commissionAsset: t.commissionAsset,
      time: t.time, isBuyer: t.isBuyer,
    })));
    if (rows.length < 1000) break;
    fromId = rows[rows.length - 1].id + 1;
  }
  return all;
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
