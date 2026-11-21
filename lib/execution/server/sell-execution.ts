import type { DashboardData } from "@/lib/types";
import { submitSpotMarketOrder, type SpotMarketOrderResponse } from "@/lib/binance";
import { replayPositionLedger, assertPositionMatchesExchange } from "../position-accounting";
import { preflightMarketSell, type MarketRules } from "../binance-preflight";
import { clientOrderIdForEvent } from "../client-order-id";
import { reconcileConfirmedSellFills } from "../fill-reconcile";
import { localSellStatusAfterReconciledSnapshot } from "../sell-order-status";
import type { SellEventRecord } from "../sell-store.browser";
import type { TradeLedgerEntry } from "../types";
import type { createBinanceReconcileAdapter } from "../binance-reconcile.server";
import type { LocalExecutionStore } from "./store";

type Adapter = ReturnType<typeof createBinanceReconcileAdapter>;
type SellKind = NonNullable<TradeLedgerEntry["sellKind"]>;

export interface ServerSellCycleDependencies {
  mode: "off" | "dry-run" | "testnet" | "production";
  store: LocalExecutionStore;
  adapter: Adapter;
  dashboard: DashboardData;
  submitOrder: (input: {
    side: "BUY" | "SELL";
    symbol: string;
    amount: string;
    clientOrderId: string;
  }) => Promise<SpotMarketOrderResponse>;
  now?: () => number;
  log?: (message: string) => void;
}

export interface ServerSellCycleResult {
  reconciled: number;
  submitted: number;
  unknown: number;
  blocked: number;
  skipped: number;
}

/** Convert the server exchangeInfo response to the same market-rule contract used by the tested sell guard. */
function toMarketRules(raw: Awaited<ReturnType<Adapter["getSymbolRules"]>>): MarketRules {
  const lot = raw.filters.find((item) => item.filterType === "MARKET_LOT_SIZE")
    ?? raw.filters.find((item) => item.filterType === "LOT_SIZE");
  const notional = raw.filters.find((item) => item.filterType === "NOTIONAL")
    ?? raw.filters.find((item) => item.filterType === "MIN_NOTIONAL");
  const stepSize = Number(lot?.stepSize);
  const minQty = Number(lot?.minQty);
  const maxQty = Number(lot?.maxQty);
  const minNotional = Number(notional?.minNotional ?? "0");
  const maxRaw = Number(notional?.maxNotional ?? "0");
  if (!lot || ![stepSize, minQty, maxQty, minNotional].every(Number.isFinite) ||
      stepSize <= 0 || minQty < 0 || maxQty < 0 || minNotional < 0 ||
      (maxRaw !== 0 && (!Number.isFinite(maxRaw) || maxRaw < 0))) {
    throw new Error("Binance卖出交易规则不完整或包含无效数值");
  }
  return {
    symbol: raw.symbol,
    status: raw.status,
    baseAsset: raw.baseAsset,
    quoteAsset: raw.quoteAsset,
    stepSize,
    minQty,
    maxQty,
    minNotional,
    maxNotional: maxRaw > 0 ? maxRaw : null,
    quotePrecision: 8,
    quoteOrderQtyMarketAllowed: raw.quoteOrderQtyMarketAllowed,
  };
}

function sellKind(value: string): SellKind {
  if (value === "take_profit" || value === "indicator_profit" ||
      value === "trail_stop" || value === "base_reduce") return value;
  throw new Error("该卖出事件类型未获自动执行授权，转人工复核");
}

function pairFor(event: SellEventRecord): string {
  const pair = event.symbol.endsWith("USDT") ? event.symbol : event.symbol + "USDT";
  if (!/^[A-Z0-9]{5,24}$/.test(pair)) throw new Error("卖出事件交易对格式无效");
  return pair;
}

function toFillTrades(trades: Awaited<ReturnType<Adapter["listOrderTrades"]>>["trades"]) {
  return trades.map((trade) => ({
    id: trade.id,
    orderId: trade.orderId,
    symbol: trade.symbol,
    isBuyer: trade.side === "BUY",
    price: Number(trade.price),
    qty: Number(trade.qty),
    quoteQty: Number(trade.quoteQty),
    commission: Number(trade.commission),
    commissionAsset: trade.commissionAsset,
    time: trade.time,
  }));
}

/** Read-only reconciliation for every claimed SELL. It never POSTs an order. */
async function reconcileSellEvent(
  event: SellEventRecord,
  deps: ServerSellCycleDependencies,
  now: () => number,
): Promise<"reconciled" | "waiting" | "blocked"> {
  if (!event.clientOrderId) return "blocked";
  const pair = pairFor(event);
  const lookup = await deps.adapter.findOrderByClientOrderId(pair, event.clientOrderId);
  if (lookup.kind === "not_found") return "waiting"; // POST结果未知时绝不重发
  const order = lookup.order;
  if (order.symbol !== pair || order.side !== "SELL" || order.clientOrderId !== event.clientOrderId) {
    await deps.store.sellEvents.updateSellEvent({
      ...event, status: "blocked", lastError: "Binance订单身份与本地SELL事件不一致，转人工复核", updatedAt: now(),
    });
    return "blocked";
  }

  const originalQuantity = Number(order.origQty);
  if (!Number.isFinite(originalQuantity) || originalQuantity <= 0 ||
      originalQuantity > event.requestedQty + Math.max(1e-12, event.requestedQty * 1e-12)) {
    await deps.store.sellEvents.updateSellEvent({
      ...event, status: "blocked", lastError: "Binance订单原始数量超过策略卖出事件授权数量，转人工复核", updatedAt: now(),
    });
    return "blocked";
  }
  const tradePage = await deps.adapter.listOrderTrades(pair, order.orderId);
  if (!tradePage.complete) return "waiting";
  const reconciled = reconcileConfirmedSellFills({
    orderId: order.orderId,
    symbol: order.symbol,
    executedQty: Number(order.executedQty),
    cummulativeQuoteQty: Number(order.cummulativeQuoteQty),
  }, toFillTrades(tradePage.trades), pair.slice(0, -4), "USDT");
  if (!reconciled.complete) return "waiting";

  const kind = sellKind(event.kind);
  for (const fill of reconciled.fills) {
    await deps.store.tradeLedger.recordConfirmedSellFill(fill, kind);
  }

  const rules = toMarketRules(await deps.adapter.getSymbolRules(pair));
  const status = localSellStatusAfterReconciledSnapshot({
    exchangeStatus: order.status,
    executedQty: Number(order.executedQty),
    origQty: Number(order.origQty),
    stepSize: rules.stepSize,
  });
  const terminal = status !== "reconcile_required";
  const timestamp = now();
  if (terminal && Number(order.executedQty) === 0) {
    await deps.store.sellEvents.updateSellEvent({
      ...event, status: "blocked", filledQty: 0, exchangeOrderId: String(order.orderId),
      lastError: `Binance订单终态${order.status}且无成交；不会自动重新提交该卖出事件`, updatedAt: timestamp,
    });
    return "blocked";
  }
  await deps.store.sellEvents.updateSellEvent({
    ...event,
    status,
    filledQty: Number(order.executedQty),
    fillIds: [...new Set([...event.fillIds, ...reconciled.fills.map((fill) => fill.fillId)])],
    exchangeOrderId: String(order.orderId),
    exchangeTerminalStatus: terminal ? order.status : undefined,
    fillReconcileCompletedAt: terminal ? timestamp : undefined,
    lotStepSize: terminal ? rules.stepSize : undefined,
    lastError: terminal ? null : "订单仍未进入交易所终态；已核验当前成交，继续只读对账",
    updatedAt: timestamp,
  });
  return "reconciled";
}

/**
 * Local-process SELL execution. Signals, reservations, confirmed fills and event
 * state all use SQLite. The clientOrderId is persisted before POST; every
 * ambiguous outcome is reconciliation-only and can never trigger a second POST.
 */
export async function runServerSellCycle(
  deps: ServerSellCycleDependencies,
): Promise<ServerSellCycleResult> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);
  const result: ServerSellCycleResult = { reconciled: 0, submitted: 0, unknown: 0, blocked: 0, skipped: 0 };
  if (deps.mode === "production") return result;

  // STOP/off只禁止新信号和新订单；已有订单仍必须继续只读恢复。
  const events = await deps.store.sellEvents.listSellEvents();
  // Recover all previously claimed/ambiguous orders before considering any new SELL.
  for (const event of events.filter((item) =>
    (item.status === "reconcile_required" || item.status === "partially_filled") && Boolean(item.clientOrderId))) {
    try {
      const outcome = await reconcileSellEvent(event, deps, now);
      if (outcome === "reconciled") result.reconciled += 1;
      else if (outcome === "blocked") result.blocked += 1;
      else result.skipped += 1;
    } catch (error) {
      result.skipped += 1;
      log(`SELL只读对账等待重试 ${event.eventKey}: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  if (deps.mode !== "testnet") return result;
  if (!deps.dashboard || deps.dashboard.source !== "binance" || deps.dashboard.stale || !deps.dashboard.market.accountKnown) {
    result.skipped += 1;
    return result;
  }
  const refreshed = await deps.store.sellEvents.listSellEvents();
  for (const event of refreshed.filter((item) => item.status === "pending")) {
    try {
      const kind = sellKind(event.kind);
      const pair = pairFor(event);
      const coin = deps.dashboard.coins.find((item) => item.symbol === event.symbol || item.symbol + "USDT" === pair);
      const price = coin?.price;
      if (!Number.isFinite(price) || (price ?? 0) <= 0) throw new Error("缺少有效Binance现价");
      const [rawRules, balances, ledger] = await Promise.all([
        deps.adapter.getSymbolRules(pair),
        deps.adapter.getAccountBalances(),
        deps.store.tradeLedger.listTradeLedger(),
      ]);
      const rules = toMarketRules(rawRules);
      const baseBalance = balances.find((item) => item.asset === rules.baseAsset);
      if (!baseBalance) throw new Error("Binance账户未返回该币种余额，停止卖出");
      const position = replayPositionLedger(ledger.filter((row) => row.symbol === pair), "USDT");
      const checked = assertPositionMatchesExchange(position, {
        freeQty: Number(baseBalance.free),
        lockedQty: Number(baseBalance.locked),
        totalQty: Number(baseBalance.free) + Number(baseBalance.locked),
      });
      const desiredQty = kind === "base_reduce"
        ? Math.min(event.requestedQty, checked.protectedBaseQty * 0.5)
        : event.requestedQty;
      const preflight = preflightMarketSell({
        rules,
        desiredQty,
        freeBaseQty: checked.freeBaseQty,
        totalPositionQty: checked.totalPositionQty,
        protectedBaseQty: checked.protectedBaseQty,
        price: price!,
        allowBaseReduction: kind === "base_reduce",
      });
      if (!preflight.ok || preflight.quantity <= 0) {
        await deps.store.sellEvents.updateSellEvent({
          ...event, status: "blocked", lastError: preflight.reason ?? "卖出预检未通过", updatedAt: now(),
        });
        result.blocked += 1;
        continue;
      }

      const clientOrderId = clientOrderIdForEvent(event.eventKey, 0);
      await deps.store.sellEvents.claimSellEventForSubmission(event.eventKey, clientOrderId, now());
      try {
        const response = await deps.submitOrder({
          side: "SELL", symbol: pair, amount: preflight.quantity.toFixed(8).replace(/0+$/, "").replace(/\.$/, ""),
          clientOrderId,
        });
        if (response.symbol !== pair || response.clientOrderId !== clientOrderId ||
            !Number.isSafeInteger(response.orderId) || response.orderId <= 0) {
          throw new Error("Binance SELL响应身份不匹配；只允许按原clientOrderId对账");
        }
        await deps.store.sellEvents.bindSellEventToExchangeOrder(event.eventKey, String(response.orderId), now());
        result.submitted += 1;
        log(`SELL已收到交易所响应：${pair} clientOrderId=${clientOrderId}，等待只读成交核验`);
      } catch (error) {
        result.unknown += 1;
        log(`SELL提交结果未知，事件已锁定且禁止重发：${clientOrderId}；${error instanceof Error ? error.message : "未知错误"}`);
      }
    } catch (error) {
      result.blocked += 1;
      log(`SELL预检/执行阻断 ${event.eventKey}: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }
  return result;
}
