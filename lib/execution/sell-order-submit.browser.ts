import {
  fetchSpotSymbolFilters,
  fetchTickers,
  BINANCE_SPOT_SELL_SUBMISSION_ENABLED,
  submitSpotMarketSell,
} from "../binance.browser";
import { parseMarketRules } from "./binance-preflight";
import { clientOrderIdForEvent } from "./client-order-id";
import { prepareQueuedSellDryRunFromBinance } from "./sell-preflight.browser";
import {
  bindSellEventToExchangeOrder,
  claimSellEventForSubmission,
  listSellEvents,
  updateSellEvent,
  type SellEventRecord,
} from "./sell-store.browser";

export interface SellOrderSubmissionResult {
  submitted: boolean;
  eventKey: string;
  clientOrderId: string | null;
  exchangeOrderId: number | null;
  exchangeStatus: string | null;
  reason: string | null;
}

function decimalPlaces(value: number): number {
  const text = Math.abs(value).toString().toLowerCase();
  const [mantissa, exponentText] = text.split("e");
  const fraction = (mantissa.split(".")[1] ?? "").length;
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  return Math.max(0, Math.min(12, fraction - exponent));
}

/** 将已按步长对齐的预检数量格式化为币安字符串，避免多余精度噪声。 */
export function formatMarketSellQuantity(quantity: number, stepSize: number): string {
  if (!Number.isFinite(quantity) || quantity <= 0 ||
      !Number.isFinite(stepSize) || stepSize <= 0) {
    throw new Error("卖出数量或交易步长无效");
  }
  const formatted = quantity.toFixed(decimalPlaces(stepSize));
  const normalized = formatted.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  if (!normalized || Number(normalized) <= 0) throw new Error("格式化后的卖出数量无效");
  return normalized;
}

/**
 * 带护栏的单次卖出提交。任何交易所请求前先检查实盘开关。
 * 若经单独评审启用，POST 前会再次核对持仓与 V3.3 底仓/周期仓边界。
 *
 * 结果不明确时保持绑定已有的 clientOrderId，禁止重发 POST；
 * 只能通过只读查询 clientOrderId 恢复订单状态。
 */
export async function submitQueuedSellEvent(eventKey: string): Promise<SellOrderSubmissionResult> {
  if (!BINANCE_SPOT_SELL_SUBMISSION_ENABLED) {
    throw new Error("现货实盘卖出尚未启用；当前不会发送 Binance 订单 POST");
  }
  if (!eventKey.trim()) throw new Error("卖出事件 ID 不能为空");

  const events = await listSellEvents();
  const event = events.find((item) => item.eventKey === eventKey);
  if (!event) throw new Error("找不到待卖事件");
  if (event.status !== "pending") {
    throw new Error("该卖出事件不是待执行状态；必须先对账，禁止重复提交");
  }
  if (!["take_profit", "indicator_profit", "trail_stop", "base_reduce"].includes(event.kind)) {
    throw new Error("该卖出事件类型尚未纳入自动卖出；基本面退出必须人工复核");
  }

  const pair = event.symbol.endsWith("USDT") ? event.symbol : event.symbol + "USDT";
  const [symbolInfo, tickers] = await Promise.all([
    fetchSpotSymbolFilters(pair),
    fetchTickers([pair]),
  ]);
  const rules = parseMarketRules(symbolInfo);
  const price = tickers[pair]?.price;
  if (rules.status !== "TRADING" || rules.quoteAsset !== "USDT") {
    throw new Error("交易对状态或报价资产不符合卖出要求");
  }
  if (!Number.isFinite(price) || (price ?? 0) <= 0) {
    throw new Error("无法读取有效的 Binance 实时价格；停止卖出");
  }

  const preflight = await prepareQueuedSellDryRunFromBinance({
    event,
    rules,
    currentPrice: price!,
  });
  if (!preflight.ok || preflight.executableQty <= 0) {
    throw new Error(preflight.reason ?? "卖出预检未通过");
  }

  const clientOrderId = clientOrderIdForEvent("SELL:" + event.eventKey, 0);
  const claimed = await claimSellEventForSubmission(event.eventKey, clientOrderId);
  const quantity = formatMarketSellQuantity(preflight.executableQty, rules.stepSize);

  try {
    const response = await submitSpotMarketSell({
      symbol: pair,
      quantity,
      clientOrderId,
    });
    await bindSellEventToExchangeOrder(event.eventKey, String(response.orderId));
    return {
      submitted: true,
      eventKey,
      clientOrderId,
      exchangeOrderId: response.orderId,
      exchangeStatus: response.status,
      reason: "Binance 已返回卖单；等待订单与逐笔成交对账后才能更新持仓和通知",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "卖单提交结果不明确";
    const parked: SellEventRecord = {
      ...claimed,
      status: "reconcile_required",
      clientOrderId,
      lastError: reason.slice(0, 500),
      updatedAt: Date.now(),
    };
    await updateSellEvent(parked);
    return {
      submitted: false,
      eventKey,
      clientOrderId,
      exchangeOrderId: null,
      exchangeStatus: null,
      reason: reason + "。事件已锁定，禁止自动重发；请先按 clientOrderId 对账",
    };
  }
}
