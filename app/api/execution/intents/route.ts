import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDashboard } from "@/lib/service";
import { binanceReconcileAdapter } from "@/lib/execution/binance-reconcile.server";
import { serverExecutionIntentId } from "@/lib/execution/server-execution-core";
import { isSignalOnly, watchlist } from "@/watchlist.config";

export const dynamic = "force-dynamic";

interface DurableObjectStubLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}
interface WorkerEnv {
  EXECUTION_ACCOUNT?: DurableObjectNamespaceLike;
}

function safeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function authenticated(req: Request): boolean {
  const expected = process.env.DASHBOARD_PASSWORD;
  const header = req.headers.get("authorization");
  if (!expected || !header?.startsWith("Basic ")) return false;
  try {
    const decoded = atob(header.slice(6));
    const separator = decoded.indexOf(":");
    return separator >= 0 && safeEqual(decoded.slice(separator + 1), expected);
  } catch {
    return false;
  }
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

function numberToDecimal(value: number): string {
  if (!Number.isFinite(value) || value <= 0) throw new Error("策略金额/数量必须是正数");
  const source = value.toString();
  let plain = source;
  if (/[eE]/.test(source)) {
    const [coefficient, exponentText] = source.toLowerCase().split("e");
    const exponent = Number(exponentText);
    const [whole, fraction = ""] = coefficient.split(".");
    const digits = whole + fraction;
    const point = whole.length + exponent;
    if (point <= 0) plain = "0." + "0".repeat(-point) + digits;
    else if (point >= digits.length) plain = digits + "0".repeat(point - digits.length);
    else plain = digits.slice(0, point) + "." + digits.slice(point);
  }
  plain = plain.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(plain)) {
    throw new Error("策略金额/数量精度超过服务端执行层支持范围");
  }
  return plain;
}

function decimalParts(value: string): { units: bigint; scale: number } {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error("账户余额十进制字段无效");
  const [whole, fraction = ""] = value.split(".");
  return { units: BigInt(whole + fraction), scale: fraction.length };
}

function decimalAtLeast(balance: string, required: string): boolean {
  const a = decimalParts(balance);
  const b = decimalParts(required);
  const scale = Math.max(a.scale, b.scale);
  return a.units * 10n ** BigInt(scale - a.scale) >= b.units * 10n ** BigInt(scale - b.scale);
}

function isoWeek(now: number): string {
  const date = new Date(now);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const year = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 864e5));
  return `${year}W${String(week).padStart(2, "0")}`;
}

/**
 * 仅在显式启用Testnet intent创建时运行。
 * 信号、金额和交易方向均由服务端getDashboard重新计算，不接受浏览器提交的信号内容。
 * 此路由只创建DO intent，不提交Binance订单。
 */
export async function POST(req: Request) {
  if (!authenticated(req)) {
    return NextResponse.json({ error: "需要有效的Dashboard认证" }, { status: 401 });
  }
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "跨站请求已拒绝" }, { status: 403 });
  }
  if (process.env.BINANCE_SPOT_ENVIRONMENT !== "testnet" ||
      process.env.BINANCE_TESTNET_INTENT_CREATION_ENABLED !== "true") {
    return NextResponse.json({ error: "服务端Testnet intent创建开关未启用；生产环境永远不接受此入口" }, { status: 403 });
  }

  try {
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > 1_024 ||
        (rawBody.trim() !== "" && rawBody.trim() !== "{}")) {
      return NextResponse.json({ error: "此入口不接受客户端策略参数" }, { status: 400 });
    }

    const dashboard = await getDashboard();
    const now = Date.now();
    if (dashboard.source !== "binance" || !dashboard.market.accountKnown ||
        dashboard.stale || !Number.isSafeInteger(dashboard.updatedAt) ||
        dashboard.updatedAt > now + 5_000 || now - dashboard.updatedAt > 45 * 60_000) {
      return NextResponse.json({
        error: "账户或行情数据不是可执行的新鲜Binance数据；禁止创建订单意图",
        stale: dashboard.stale,
        source: dashboard.source,
      }, { status: 409 });
    }

    const context = getCloudflareContext();
    const env = context.env as unknown as WorkerEnv;
    const namespace = env.EXECUTION_ACCOUNT;
    if (!namespace) return NextResponse.json({ error: "Durable Object执行账户绑定未配置" }, { status: 503 });
    const coordinator = namespace.get(namespace.idFromName("binance-spot-primary"));

    const balances = await binanceReconcileAdapter.getAccountBalances();
    const byAsset = new Map(balances.map((item) => [item.asset, item.free]));
    const week = isoWeek(now);
    const results: Array<{
      intentId: string; symbol: string; side: string; kind: string; state: string; created: boolean;
    }> = [];

    for (const coin of dashboard.coins) {
      const item = watchlist.find((entry) => entry.symbol === coin.symbol);
      if (!item || isSignalOnly(item)) continue;
      const action = coin.signal.action;
      if ((action.side !== "buy" && action.side !== "sell") ||
          !Array.isArray(action.blocked) || action.blocked.length > 0 ||
          !/^[A-Za-z][A-Za-z0-9]{1,23}$/.test(action.kind)) continue;

      const symbol = coin.symbol + "USDT";
      const rules = await binanceReconcileAdapter.getSymbolRules(symbol);
      const lotSize = rules.filters.find((filter) => filter.filterType === "LOT_SIZE");
      const priceFilter = rules.filters.find((filter) => filter.filterType === "PRICE_FILTER");
      const notionalFilter = rules.filters.find((filter) =>
        filter.filterType === "MIN_NOTIONAL" || filter.filterType === "NOTIONAL");
      if (rules.symbol !== symbol || rules.status !== "TRADING" || rules.quoteAsset !== "USDT" ||
          !lotSize?.stepSize || !lotSize.minQty || !priceFilter?.tickSize ||
          !notionalFilter?.minNotional) continue;

      const side = action.side === "buy" ? "BUY" : "SELL";
      if (side === "BUY" && !rules.quoteOrderQtyMarketAllowed) continue;
      const requiredAsset = side === "BUY" ? "USDT" : rules.baseAsset;
      const rawAmount = side === "BUY" ? action.usdt : action.qty;
      if (typeof rawAmount !== "number" || !Number.isFinite(rawAmount) || rawAmount <= 0) continue;
      const amount = numberToDecimal(rawAmount);
      const free = byAsset.get(requiredAsset) ?? "0";
      if (!decimalAtLeast(free, amount)) continue;

      const strategyEventId = `${coin.symbol}:${action.kind}:${week}`;
      const intentId = serverExecutionIntentId(strategyEventId);
      const response = await coordinator.fetch("https://execution.internal/internal/intents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intentId,
          strategyEventId,
          strategyVersion: "3.3",
          symbol,
          side,
          quoteAsset: "USDT",
          amount,
          createdAt: now,
        }),
      });
      const payload = await response.json().catch(() => ({})) as {
        accepted?: boolean; created?: boolean; intentId?: string; state?: string; error?: string;
      };
      if (!response.ok || payload.accepted !== true || payload.intentId !== intentId) {
        results.push({
          intentId, symbol, side, kind: action.kind,
          state: payload.error ?? `DO intent创建失败（HTTP ${response.status}）`,
          created: false,
        });
        continue;
      }
      results.push({
        intentId, symbol, side, kind: action.kind,
        state: payload.state ?? "queued",
        created: payload.created === true,
      });
    }

    return NextResponse.json({
      ok: true,
      mode: "testnet_intent_only",
      created: results.filter((item) => item.created).length,
      intents: results,
      orderSubmitted: false,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 180) : "Testnet intent创建失败";
    console.error("[execution-intents]", detail);
    return NextResponse.json({ error: "服务端订单意图创建失败", detail }, {
      status: 502, headers: { "Cache-Control": "no-store" },
    });
  }
}
