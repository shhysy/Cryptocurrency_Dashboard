import type { SpotSymbolFilters } from "../binance.browser";

export interface MarketRules {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  stepSize: number;
  minQty: number;
  maxQty: number;
  minNotional: number;
  maxNotional: number | null;
  quoteOrderQtyMarketAllowed: boolean;
}

function filterOf(filters: SpotSymbolFilters["filters"], type: string) {
  return filters.find((item) => item.filterType === type);
}

/** Convert an exchange decimal string into a safe number, rejecting malformed values. */
function num(value: unknown, label: string): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error(`Binance ${label} 规则无效`);
  return result;
}

export function parseMarketRules(info: SpotSymbolFilters): MarketRules {
  const lot = filterOf(info.filters, "MARKET_LOT_SIZE") ?? filterOf(info.filters, "LOT_SIZE");
  if (!lot) throw new Error(`交易对 ${info.symbol} 缺少 LOT_SIZE 规则`);
  const notional = filterOf(info.filters, "NOTIONAL") ?? filterOf(info.filters, "MIN_NOTIONAL");
  const minNotional = notional
    ? num(notional.minNotional, "minNotional")
    : 0;
  const maxRaw = notional?.maxNotional;
  const maxNotional = maxRaw == null || Number(maxRaw) <= 0 ? null : num(maxRaw, "maxNotional");
  return {
    symbol: info.symbol,
    status: info.status,
    baseAsset: info.baseAsset,
    quoteAsset: info.quoteAsset,
    stepSize: num(lot.stepSize, "stepSize"),
    minQty: num(lot.minQty, "minQty"),
    maxQty: num(lot.maxQty, "maxQty"),
    minNotional,
    maxNotional,
    quoteOrderQtyMarketAllowed: Boolean((info as SpotSymbolFilters & { quoteOrderQtyMarketAllowed?: boolean }).quoteOrderQtyMarketAllowed),
  };
}

/** Floor to exchange step using decimal arithmetic rather than floating-point remainder. */
export function floorToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(step) || step <= 0) return 0;
  const decimals = Math.min(12, Math.max(
    (String(value).split(".")[1] ?? "").length,
    (String(step).split(".")[1] ?? "").length,
  ));
  const scale = 10 ** decimals;
  const v = Math.floor((value * scale + 1e-8) / (step * scale)) * step;
  return Number(v.toFixed(decimals));
}

export interface BuyPreflight {
  ok: boolean;
  quoteOrderQty: string | null;
  estimatedBaseQty: number;
  reason: string | null;
}

/** Preflight only. Does not submit an order or reserve funds. */
export function preflightMarketBuy(
  rules: MarketRules,
  requestedUsdt: number,
  freeUsdt: number,
  price: number,
): BuyPreflight {
  if (rules.status !== "TRADING") return { ok: false, quoteOrderQty: null, estimatedBaseQty: 0, reason: "交易对当前不可交易" };
  if (rules.quoteAsset !== "USDT") return { ok: false, quoteOrderQty: null, estimatedBaseQty: 0, reason: "报价资产不是 USDT" };
  if (!rules.quoteOrderQtyMarketAllowed) return { ok: false, quoteOrderQty: null, estimatedBaseQty: 0, reason: "交易对未开放 quoteOrderQty 市价买入" };
  if (![requestedUsdt, freeUsdt, price].every(Number.isFinite) || requestedUsdt <= 0 || freeUsdt <= 0 || price <= 0) {
    return { ok: false, quoteOrderQty: null, estimatedBaseQty: 0, reason: "买入金额、USDT 余额或价格无效" };
  }
  const quote = Math.min(requestedUsdt, freeUsdt);
  const estimatedBaseQty = quote / price;
  if (quote < rules.minNotional) return { ok: false, quoteOrderQty: null, estimatedBaseQty, reason: "低于交易所最小名义金额" };
  if (rules.maxNotional !== null && quote > rules.maxNotional) return { ok: false, quoteOrderQty: null, estimatedBaseQty, reason: "超过交易所最大名义金额" };
  if (estimatedBaseQty < rules.minQty || estimatedBaseQty > rules.maxQty) {
    return { ok: false, quoteOrderQty: null, estimatedBaseQty, reason: "预计买入数量不符合交易所数量限制" };
  }
  // quoteOrderQty is a quote-asset amount; keep precision conservative and never exceed free USDT.
  const quotePrecision = 8;
  const rounded = Math.floor(quote * 10 ** quotePrecision) / 10 ** quotePrecision;
  return { ok: rounded >= rules.minNotional, quoteOrderQty: rounded.toFixed(quotePrecision), estimatedBaseQty, reason: rounded >= rules.minNotional ? null : "精度处理后低于最小名义金额" };
}

export interface SellPreflight {
  ok: boolean;
  quantity: number;
  reason: string | null;
}

/** Protects the locked long-term base. Only explicitly authorized base-reduction events may cross that floor. */
export function preflightMarketSell(input: {
  rules: MarketRules;
  desiredQty: number;
  freeBaseQty: number;
  totalPositionQty: number;
  protectedBaseQty: number;
  price: number;
  allowBaseReduction?: boolean;
}): SellPreflight {
  const { rules } = input;
  if (rules.status !== "TRADING") return { ok: false, quantity: 0, reason: "交易对当前不可交易" };
  if (![input.desiredQty, input.freeBaseQty, input.totalPositionQty, input.protectedBaseQty, input.price].every(Number.isFinite)
    || input.desiredQty <= 0 || input.freeBaseQty <= 0 || input.totalPositionQty <= 0 || input.price <= 0) {
    return { ok: false, quantity: 0, reason: "卖出数量、持仓或价格无效" };
  }
  const cycleAvailable = Math.max(0, input.totalPositionQty - (input.allowBaseReduction ? 0 : input.protectedBaseQty));
  const raw = Math.min(input.desiredQty, input.freeBaseQty, cycleAvailable, rules.maxQty);
  const quantity = floorToStep(raw, rules.stepSize);
  if (quantity < rules.minQty) return { ok: false, quantity: 0, reason: "卖出数量低于交易所最小数量" };
  if (quantity * input.price < rules.minNotional) return { ok: false, quantity: 0, reason: "卖出金额低于交易所最小名义金额" };
  if (rules.maxNotional !== null && quantity * input.price > rules.maxNotional) return { ok: false, quantity: 0, reason: "卖出金额超过交易所最大名义金额" };
  if (!input.allowBaseReduction && quantity > cycleAvailable + 1e-10) return { ok: false, quantity: 0, reason: "卖出会触及长期底仓保护线" };
  return { ok: true, quantity, reason: null };
}
