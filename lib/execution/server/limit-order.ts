/**
 * Binance Spot LIMIT GTC 定价与数量规则。
 * 所有计算使用 BigInt 定点数，禁止用浮点数计算 tickSize/stepSize。
 */

const SCALE = 18n;
const UNIT = 10n ** SCALE;

function toUnits(value: string, label: string): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9]\\d*)(?:\\.\\d{1,18})?$/.test(value)) {
    throw new Error(`${label}必须是最多18位小数的非负十进制字符串`);
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * UNIT + BigInt((fraction + "0".repeat(18)).slice(0, 18) || "0");
}

function fromUnits(value: bigint): string {
  if (value < 0n) throw new Error("金额不能为负数");
  const whole = value / UNIT;
  const fraction = (value % UNIT).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function ceilDiv(value: bigint, divisor: bigint): bigint {
  if (value < 0n || divisor <= 0n) throw new Error("定点数除法参数无效");
  return (value + divisor - 1n) / divisor;
}

export type LimitOrderSide = "BUY" | "SELL";

export interface LimitOrderPrice {
  referencePrice: string;
  limitPrice: string;
  side: LimitOrderSide;
  tickSize: string;
}

/**
 * BUY: 参考价 × 1.005 后按 tickSize 向下取整。
 * SELL: 参考价 × 0.995 后按 tickSize 向上取整。
 * 方向取整保证 BUY 不超过 +0.5% 上限，SELL 不低于 -0.5% 底线。
 */
export function calculateLimitOrderPrice(input: LimitOrderPrice): string {
  const reference = toUnits(input.referencePrice, "参考价格");
  const tick = toUnits(input.tickSize, "tickSize");
  if (reference <= 0n || tick <= 0n) throw new Error("参考价格和 tickSize 必须大于0");

  const numerator = input.side === "BUY" ? 1005n : 995n;
  const rawTarget = reference * numerator / 1000n;
  const tickCount = input.side === "BUY"
    ? rawTarget / tick
    : ceilDiv(rawTarget, tick);
  const result = tickCount * tick;
  if (result <= 0n) throw new Error("计算出的限价无效");
  return fromUnits(result);
}

/** 按 stepSize 向下取整数量，绝不超过原始可用数量。 */
export function floorQuantityToStep(quantity: string, stepSize: string): string {
  const qty = toUnits(quantity, "订单数量");
  const step = toUnits(stepSize, "stepSize");
  if (qty <= 0n || step <= 0n) throw new Error("订单数量和 stepSize 必须大于0");
  return fromUnits((qty / step) * step);
}

/** 按报价资产预算和限价计算基础资产数量，再按 LOT_SIZE.stepSize 向下取整。 */
export function quoteBudgetToBaseQuantity(
  quoteBudget: string,
  limitPrice: string,
  stepSize: string,
): string {
  const quote = toUnits(quoteBudget, "报价资产预算");
  const price = toUnits(limitPrice, "限价");
  const step = toUnits(stepSize, "stepSize");
  if (quote <= 0n || price <= 0n || step <= 0n) {
    throw new Error("报价资产预算、限价和 stepSize 必须大于0");
  }
  const rawQuantity = quote * UNIT / price;
  return fromUnits((rawQuantity / step) * step);
}

/** 计算价格×数量的名义金额（保留18位小数，向下截断）。 */
export function calculateLimitNotional(price: string, quantity: string): string {
  const p = toUnits(price, "限价");
  const q = toUnits(quantity, "订单数量");
  if (p <= 0n || q <= 0n) throw new Error("限价和订单数量必须大于0");
  return fromUnits(p * q / UNIT);
}
